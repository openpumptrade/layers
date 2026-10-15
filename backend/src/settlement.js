import { PublicKey, SystemProgram } from "@solana/web3.js";
import { config, mode } from "./config.js";
import { sql, getMeta, setMeta } from "./db.js";
import { decryptSecret } from "./crypto.js";
import { connection, keypairFromSecret, sendTx, LAMPORTS } from "./solana.js";
import { claimCreatorFees, creatorFeesRaw, loadCurve, buyAny, burnTokens, transferTokens, tokenBalanceRaw, tokenBalanceRawSettled, quoteBalance, totalSupply, mintProgramId, multiHopSellToSol, jupiterSwapSolTo, toRaw, fromRaw, DECIMALS } from "./pumpfun.js";
import { coins, liveCoins, quoteOf, usdOfQuote, quotePathToSol } from "./stack.js";
import { market, refreshCoin, fuelOf } from "./tracker.js";

/// The settlement. One clock for the whole stack — every CYCLE_INTERVAL_SEC, on a fixed cadence, per coin:
///   1. sweep + claim 100% of the creator fees into the coin's sequencer wallet
///      (SOL for $L1; for a layer the fees are in the layer it runs on — its tax)
///   2. SELF_SHARE → one buy of the coin itself on its curve / pool → every token that buy brought in is burned
///      DOWN_SHARE → the layer below is burned on the spot: fees settle down. $L1 has nothing below it, so for
///                   $L1 this share also buys $L1 back and burns it
///      OPS_SHARE  → the ops wallet (in the coin's quote); 0 by default
/// A pot under MIN_SAP_USD waits in the wallet for the next settlement. A failed step is retried next time — the
/// fees are still there. A coin wallet low on SOL sells a slice of its pot down the chain to SOL (gas).

export const state = { genesis: 0, nextCycleAt: 0, cycle: 0, firing: false, lastRunAt: 0, lastSummary: null };
const now = () => Math.floor(Date.now() / 1000);
const fmt = (n, d = 0) => Number(n).toLocaleString("en-US", { maximumFractionDigits: d });

export async function startSettlement() {
  state.genesis = Number(await getMeta("settle_genesis", 0));
  if (!state.genesis) { state.genesis = now(); await setMeta("settle_genesis", state.genesis); }
  state.cycle = Number(await getMeta("settle_cycle", 0));
  state.nextCycleAt = Number(await getMeta("settle_next_at", 0));
  await sql`update runs set status = 'failed', note = coalesce(note, 'interrupted by restart'), finished_at = ${now()} where status in ('claiming', 'buying', 'burning')`;
  if (!state.nextCycleAt || state.nextCycleAt < now() - config.rules.intervalSec) await schedule();
  setInterval(tick, 3_000);
  console.log(`[settle] every ${config.rules.intervalSec}s · split self ${config.split.selfBps / 100}% / down ${config.split.downBps / 100}% / ops ${config.split.opsBps / 100}% · next run at ${new Date(state.nextCycleAt * 1000).toISOString()}`);
}

async function schedule() {
  const iv = config.rules.intervalSec;
  const k = Math.floor((now() - state.genesis) / iv) + 1;
  state.nextCycleAt = state.genesis + k * iv;
  await setMeta("settle_next_at", state.nextCycleAt);
}

async function tick() {
  if (state.firing || now() < state.nextCycleAt) return;
  if (!config.schedulerEnabled) { await schedule(); return; }
  state.firing = true;
  try {
    state.cycle++; await setMeta("settle_cycle", state.cycle);
    const list = liveCoins().sort((a, b) => a.depth - b.depth);
    console.log(`[settle] ⛓ settlement #${state.cycle} · ${list.length} coins`);
    const summary = { cycle: state.cycle, at: now(), coins: list.length, done: 0, skipped: 0, failed: 0, feesUsd: 0 };
    // $L1 first, alone (its wallet is the env key); then the launched layers a few at a time
    const l1 = list.find((c) => c.isL1), rest = list.filter((c) => !c.isL1);
    if (l1) await runCoin(l1, summary);
    const queue = [...rest];
    await Promise.all(Array.from({ length: Math.max(1, config.cycleConcurrency) }, async () => { for (;;) { const c = queue.shift(); if (!c) return; await runCoin(c, summary); } }));
    state.lastSummary = summary; state.lastRunAt = now();
    console.log(`[settle] run #${state.cycle} done · ${summary.done} ran · ${summary.skipped} waited · ${summary.failed} failed · $${summary.feesUsd.toFixed(2)} of fees settled`);
  } catch (err) {
    console.error("[settle] run failed:", String(err.message).slice(0, 200));
  } finally { await schedule(); state.firing = false; }
}

export function rowToJson(r) {
  return {
    id: r.id, mint: r.mint, cycle: r.cycle, t: r.ts, status: r.status, dry: r.dry, potQuote: r.pot_quote, claimedQuote: r.claimed_quote, selfQuote: r.self_quote, selfBurned: r.self_burned, downQuote: r.down_quote, opsQuote: r.ops_quote, gasQuote: r.gas_quote,
    quoteUsd: r.quote_usd, priceUsd: r.price_usd, solUsd: r.sol_usd, supplyAfter: r.supply_after, feesUsd: (r.self_quote + r.down_quote + r.ops_quote) * (r.quote_usd || 0),
    venue: r.venue, claimTx: r.claim_tx, buyTx: r.buy_tx, burnTx: r.burn_tx, downTx: r.down_tx, opsTx: r.ops_tx, gasTx: r.gas_tx, note: r.note, finishedAt: r.finished_at,
  };
}

const setProgress = (c, patch) => { c.progressState = { ...(c.progressState || {}), ...patch, at: now() }; };

async function runCoin(c, summary) {
  const dry = config.dryRun || (c.isL1 && mode() !== "bot");
  const quote = quoteOf(c);
  const quoteUsd = usdOfQuote(c, market.solUsd);
  const parent = c.parent ? coins.get(c.parent) : null;
  const ts = now();
  let runId = 0;
  try {
    await refreshCoin(c).catch(() => {});
    const curve = await loadCurve(c.mint).catch(() => null);
    const unclaimed = c.pot.unclaimed;
    const inWallet = c.isL1 ? Math.max(0, c.pot.walletSol - config.rules.gasReserveSol) : c.pot.walletQuote;
    const pot = unclaimed + (dry ? 0 : inWallet);
    const [{ id }] = await sql`insert into runs (mint, cycle, ts, status, dry, pot_quote, quote_usd, price_usd, sol_usd) values (${c.mint}, ${state.cycle}, ${ts}, 'claiming', ${dry}, ${pot}, ${quoteUsd}, ${c.priceUsd}, ${market.solUsd}) returning id`;
    runId = id;
    setProgress(c, { status: "claiming", runId: id, dry, pot, claimed: 0, selfBurned: 0, downBurned: 0, txs: {}, note: null });
    const finish = async (status, patch, msg) => {
      await sql`update runs set status = ${status}, note = ${msg}, finished_at = ${now()}, claimed_quote = ${patch.claimed || 0}, self_quote = ${patch.self || 0}, self_burned = ${patch.selfBurned || 0}, down_quote = ${patch.down || 0}, ops_quote = ${patch.ops || 0}, gas_quote = ${patch.gas || 0}, venue = ${patch.venue || null}, claim_tx = ${patch.txs?.claim || null}, buy_tx = ${patch.txs?.buy || null}, burn_tx = ${patch.txs?.burn || null}, down_tx = ${patch.txs?.down || null}, ops_tx = ${patch.txs?.ops || null}, gas_tx = ${patch.txs?.gas || null}, supply_after = ${patch.supply || c.supply} where id = ${id}`;
      setProgress(c, { status, ...patch, note: msg });
      c.lastCycleAt = now(); c.lastNote = msg;
      const feesUsd = ((patch.self || 0) + (patch.down || 0) + (patch.ops || 0)) * quoteUsd;
      if (status === "done") {
        c.cyclesRun++; c.totalClaimedQuote += patch.claimed || 0; c.totalSelfQuote += patch.self || 0; c.totalSelfBurned += patch.selfBurned || 0; c.totalDownQuote += patch.down || 0; c.totalOpsQuote += patch.ops || 0; c.totalFeesUsd += feesUsd;
        if (!dry) await sql`update coins set cycles_run = cycles_run + 1, total_claimed_quote = total_claimed_quote + ${patch.claimed || 0}, total_self_quote = total_self_quote + ${patch.self || 0}, total_self_burned = total_self_burned + ${patch.selfBurned || 0}, total_down_quote = total_down_quote + ${patch.down || 0}, total_ops_quote = total_ops_quote + ${patch.ops || 0}, total_sap_usd = total_sap_usd + ${feesUsd}, ops_owed_quote = ${c.opsOwedQuote}, last_cycle_at = ${now()}, last_note = ${msg} where mint = ${c.mint}`;
        summary.done++; summary.feesUsd += dry ? 0 : feesUsd;
      } else { await sql`update coins set last_cycle_at = ${now()}, last_note = ${msg} where mint = ${c.mint}`; if (status === "failed") summary.failed++; else summary.skipped++; }
      console.log(`[settle] ${status === "done" ? "🍯" : status === "failed" ? "✖" : "▫️"} $${c.symbol} #${id} ${status}: ${msg}`);
    };

    const splitSelf = config.split.selfBps / 10_000, splitDown = config.split.downBps / 10_000, splitOps = config.split.opsBps / 10_000;
    if (dry) {
      const spend = unclaimed;
      const ok = spend * quoteUsd >= config.rules.minSapUsd;
      const self = ok ? spend * (c.isL1 ? splitSelf + splitDown : splitSelf) : 0, down = ok && !c.isL1 ? spend * splitDown : 0, ops = ok ? spend * splitOps : 0;
      const msg = ok ? `would claim ${spend.toFixed(4)} ${quote.symbol} · ${self.toFixed(4)} buys $${c.symbol} back and burns it${c.isL1 ? "" : ` · ${down.toFixed(4)} $${quote.symbol} burned`}` : `pot ${spend.toFixed(4)} ${quote.symbol} (~$${(spend * quoteUsd).toFixed(2)}) under the $${config.rules.minSapUsd} minimum — waits`;
      return finish(ok ? "done" : "skipped", { claimed: ok ? spend : 0, self, down, ops }, msg);
    }

    // the keys
    const wallet = c.isL1 ? config.l1Wallet : keypairFromSecret(decryptSecret((await sql`select wallet_secret_enc from coins where mint = ${c.mint}`)[0].wallet_secret_enc));
    const me = wallet.publicKey.toBase58();
    const txs = {};
    const patch = { claimed: 0, self: 0, selfBurned: 0, down: 0, ops: 0, gas: 0, txs, venue: null };

    // 0. gas: refill from the pot when a layer's wallet is running dry (sell a slice of its quote down the chain)
    let walletSol = c.pot.walletSol;
    if (!c.isL1 && walletSol < config.rules.gasRefillBelowSol && config.rules.gasRefillUsd > 0) {
      const have = await quoteBalance(me, quote);
      const slice = Math.min(have, quoteUsd > 0 ? config.rules.gasRefillUsd / quoteUsd : 0);
      if (slice > 0 && slice * quoteUsd >= 0.2) {
        try {
          const { sig } = await multiHopSellToSol({ wallet, path: quotePathToSol(c), amountRaw: toRaw(slice, quote.decimals) });
          txs.gas = sig; patch.gas = slice; walletSol = (await connection.getBalance(wallet.publicKey)) / LAMPORTS;
          console.log(`[settle] $${c.symbol}: sold ${slice.toFixed(4)} $${quote.symbol} down the chain for gas → ${walletSol.toFixed(4)} SOL · ${sig}`);
        } catch (err) { console.warn(`[settle] $${c.symbol}: gas refill failed: ${String(err.message).slice(0, 120)}`); }
      }
    }
    if (walletSol < config.rules.minGasSol) return finish("failed", patch, `engine wallet has ${walletSol.toFixed(4)} SOL — needs ${config.rules.minGasSol} SOL for fees`);

    // 1. claim — sweep the v3 bucket + collect both vaults, in the coin's quote
    if (unclaimed * quoteUsd >= config.rules.minClaimUsd) {
      const before = await quoteBalance(me, quote);
      const { sig } = await claimCreatorFees({ wallet, mint: c.mint, quote, curve, graduated: c.graduated });
      if (sig) { txs.claim = sig; const after = await quoteBalance(me, quote); patch.claimed = Math.max(0, after - before); console.log(`[settle] $${c.symbol}: claimed ${patch.claimed.toFixed(4)} ${quote.symbol} · ${sig}`); }
    }
    const walletQuote = await quoteBalance(me, quote);
    const spend = Math.max(0, (c.isL1 ? walletQuote - config.rules.gasReserveSol : walletQuote) - (c.opsOwedQuote || 0));
    await sql`update runs set claimed_quote = ${patch.claimed}, claim_tx = ${txs.claim || null}, status = 'buying' where id = ${runId}`;
    setProgress(c, { status: "buying", claimed: patch.claimed, txs: { ...txs } });
    if (spend * quoteUsd < config.rules.minSapUsd) return finish("skipped", patch, `${spend.toFixed(4)} ${quote.symbol} (~$${(spend * quoteUsd).toFixed(2)}) available, under the $${config.rules.minSapUsd} minimum — waits for the next run`);

    // 2. the split
    const selfQuote = spend * (c.isL1 ? splitSelf + splitDown : splitSelf), downQuote = c.isL1 ? 0 : spend * splitDown, opsQuote = spend * splitOps;
    const programId = await mintProgramId(c.mint);
    const errors = [];

    // 2a. SELF: one buy of the coin with its quote, then burn exactly what the buy brought in
    if (selfQuote > 0) {
      const before = await tokenBalanceRaw(me, c.mint, programId);
      try {
        const r = await buyAny({ wallet, mint: c.mint, quote, quoteAmountRaw: toRaw(selfQuote, quote.decimals), programId, graduated: c.graduated });
        txs.buy = r.sig; patch.venue = r.venue; patch.self = r.quoteInRaw ? fromRaw(r.quoteInRaw, quote.decimals) : selfQuote; // pumpswap spends budget / (1 + slippage); the rest waits for the next settlement
        const after = await tokenBalanceRawSettled(me, c.mint, programId, before);
        const delta = after > before ? after - before : 0n;
        if (delta > 0n) { const b = await burnTokens({ wallet, mint: c.mint, programId, amountRaw: delta }); txs.burn = b.sig; patch.selfBurned = fromRaw(delta, DECIMALS); }
        console.log(`[settle] $${c.symbol}: ${selfQuote.toFixed(4)} ${quote.symbol} → ${fmt(patch.selfBurned)} $${c.symbol} burned (${r.venue}) · ${r.sig}`);
      } catch (err) { errors.push(`self buy: ${String(err.message).slice(0, 140)}`); }
      setProgress(c, { status: "burning", selfBurned: patch.selfBurned, txs: { ...txs } });
    }
    // 2b. DOWN: burn the layer below — fees settle down
    if (downQuote > 0 && parent) {
      try {
        const raw = toRaw(downQuote, quote.decimals);
        const have = await tokenBalanceRaw(me, quote.mint, quote.tokenProgram);
        const b = await burnTokens({ wallet, mint: quote.mint, programId: quote.tokenProgram, amountRaw: raw > have ? have : raw, decimals: quote.decimals });
        txs.down = b.sig; patch.down = fromRaw(b.amount, quote.decimals);
        console.log(`[settle] $${c.symbol}: burned ${patch.down.toFixed(4)} $${quote.symbol} (its parent) · ${b.sig}`);
      } catch (err) { errors.push(`down burn: ${String(err.message).slice(0, 140)}`); }
    }
    // 2c. OPS
    if (opsQuote > 0) {
      c.opsOwedQuote = (c.opsOwedQuote || 0) + opsQuote;
      if (config.opsWallet) {
        try {
          const amt = c.opsOwedQuote;
          const sig = c.isL1
            ? await sendTx({ instructions: [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(config.opsWallet), lamports: Math.floor(amt * LAMPORTS) })], payer: wallet.publicKey, signers: [wallet], computeUnits: 10_000 })
            : (await transferTokens({ wallet, mint: quote.mint, to: config.opsWallet, programId: quote.tokenProgram, amountRaw: toRaw(amt, quote.decimals), decimals: quote.decimals })).sig;
          txs.ops = sig; patch.ops = amt; c.opsOwedQuote = 0;
        } catch (err) { errors.push(`ops: ${String(err.message).slice(0, 100)}`); }
      }
    }
    patch.supply = await totalSupply(c.mint).catch(() => c.supply);
    const status = txs.buy || txs.down ? "done" : "failed";
    const msg = status === "done"
      ? `${patch.self.toFixed(4)} ${quote.symbol} → ${fmt(patch.selfBurned)} $${c.symbol} burned${patch.down ? ` · ${patch.down.toFixed(4)} $${quote.symbol} burned` : ""}${patch.ops ? ` · ${patch.ops.toFixed(4)} ops` : ""}${errors.length ? ` · ${errors.join("; ")}` : ""}`
      : errors.join("; ") || "nothing to do";
    await refreshCoin(c).catch(() => {});
    return finish(status, patch, msg);
  } catch (err) {
    const msg = String(err.message).slice(0, 200);
    console.error(`[settle] $${c.symbol} failed:`, msg);
    if (runId) await sql`update runs set status = 'failed', note = ${msg}, finished_at = ${now()} where id = ${runId}`;
    await sql`update coins set last_cycle_at = ${now()}, last_note = ${"failed: " + msg} where mint = ${c.mint}`;
    c.lastNote = "failed: " + msg; setProgress(c, { status: "failed", note: msg }); summary.failed++;
  }
}

export { fuelOf, jupiterSwapSolTo };
