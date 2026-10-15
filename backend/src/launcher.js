import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { sql } from "./db.js";
import { config } from "./config.js";
import { decryptSecret } from "./crypto.js";
import { connection, getSolBalance, keypairFromSecret, sendTx, LAMPORTS } from "./solana.js";
import { buildCreate, resolveQuote, multiHopBuy, mintProgramId, tokenBalanceRawSettled, totalSupply, transferAllTokens, uploadIpfs, loadCurve, maxDepthAllowed, WSOL_MINT } from "./pumpfun.js";
import { coins, onCoinLive, pathFromSol } from "./stack.js";

/// The launcher ("roll up"). Watches awaiting_deposit launches; once the user's SOL lands in the coin's
/// fresh wallet it: uploads the metadata, resolves the BASE layer as a pump-coin quote (the SDK walks
/// its quote chain down to $L1 and returns the remaining accounts create_v2 needs), creates the coin
/// with create_v2 carrying the tax, buys the dev position straight from SOL with one multi_hop_swap
/// (SOL → $L1 → … → base layer → the new coin) and sends those tokens to the user.
/// Whatever SOL is left is the coin wallet's permanent gas reserve for the settlements.

let running = false;

export function startLauncher() {
  setInterval(tick, 5_000);
  console.log("[launch] watching deposits every 5s");
}

async function tick() {
  if (running) return;
  running = true;
  try {
    await sql`update coins set status = 'expired' where status = 'awaiting_deposit' and created_at < now() - make_interval(mins => ${config.depositTimeoutMin})`;
    const rows = await sql`select * from coins where status = 'awaiting_deposit' order by created_at asc limit 20`;
    for (const row of rows) {
      const balance = await getSolBalance(row.wallet).catch(() => 0);
      if (balance + 1e-9 >= row.deposit_expected_sol) {
        await sql`update coins set status = 'launching' where launch_id = ${row.launch_id} and status = 'awaiting_deposit'`;
        launch(row).catch(async (err) => {
          console.error(`[launch] ${row.launch_id} failed:`, err.message);
          await sql`update coins set status = 'failed', error = ${String(err.message).slice(0, 500)} where launch_id = ${row.launch_id}`;
          await refundDeposit(row).catch((e) => console.error(`[launch] refund ${row.launch_id} failed:`, e.message));
        });
      }
    }
    await sweepExpired();
  } catch (err) {
    console.error("[launch] tick error:", err.message);
  } finally { running = false; }
}

/// SOL that lands on a launch whose window already expired would sit in a wallet nobody watches: refunded once a minute.
let lastSweep = 0;
async function sweepExpired() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  const rows = await sql`select * from coins where status = 'expired' and created_at > now() - interval '7 days' order by created_at desc limit 25`;
  for (const row of rows) {
    const balance = await getSolBalance(row.wallet).catch(() => 0);
    if (balance < 0.0005) continue;
    console.log(`[launch] ${row.launch_id} expired but holds ${balance} SOL — refunding ${row.user_wallet}`);
    await refundDeposit(row).catch((e) => console.error(`[launch] late refund ${row.launch_id} failed:`, e.message));
  }
}

/// A failed launch never keeps the user's money: the SOL goes back, to exactly 0.
export async function refundDeposit(row) {
  const wallet = keypairFromSecret(decryptSecret(row.wallet_secret_enc));
  const balance = await connection.getBalance(wallet.publicKey);
  const refund = balance - 6_000; // 5000 base + priority; anything between 0 and rent-exempt is rejected
  if (refund <= 0) return;
  const sig = await sendTx({ instructions: [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(row.user_wallet), lamports: refund })], payer: wallet.publicKey, signers: [wallet], computeUnits: 10_000 });
  await sql`update coins set status = 'refunded', refund_tx = ${sig} where launch_id = ${row.launch_id}`;
  console.log(`[launch] refunded ${(refund / LAMPORTS).toFixed(6)} SOL → ${row.user_wallet} (${sig})`);
}

/// Can `parentMint` take a child right now? Depth gate (pump.fun's + ours), eligibility (not mayhem,
/// chain rooted in SOL), nothing awaiting migration. Returns the resolved quote (with the create accounts).
export async function resolveParent(parentMint) {
  const parent = coins.get(parentMint);
  if (!parent || parent.status !== "live") throw new Error("the base layer is not on the stack");
  const allowed = await maxDepthAllowed();
  if (parent.depth + 1 > allowed) throw new Error(`the stack is capped at depth ${allowed} right now — ${parent.symbol} is L${parent.depth + 1}, its layers would be L${parent.depth + 2}`);
  const quote = await resolveQuote(parentMint); // throws typed SDK errors (CurveDepthExceeded, QuoteCurveAwaitingMigration…)
  if (quote.source !== "pumpCoin") throw new Error(`${parent.symbol} resolved as a ${quote.source} quote, not a pump coin`);
  if (quote.depth !== parent.depth + 1) console.warn(`[launch] chain says ${parent.symbol}'s children get depth ${quote.depth}, the stack says ${parent.depth + 1}`);
  return { parent, quote };
}

async function launch(row) {
  const wallet = keypairFromSecret(decryptSecret(row.wallet_secret_enc));
  const { parent, quote } = await resolveParent(row.parent_mint);
  console.log(`[launch] rolling up "${row.name}" ($${row.symbol}) on $${parent.symbol} (depth ${quote.depth}) from ${row.wallet} · tax ${row.creator_tax_bps / 100}%`);

  // the mint is generated up front so the coin's own page is its website in the pump.fun metadata
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey.toBase58();
  const website = `${config.brand.siteUrl}/c/${mint}`;

  // 1. metadata → pump.fun IPFS
  let imageBuffer = Buffer.alloc(0), imageMime = "image/png";
  if (row.image_upload_id) {
    const [up] = await sql`select mime, data from uploads where id = ${row.image_upload_id}`;
    if (up) { imageBuffer = Buffer.from(up.data, "base64"); imageMime = up.mime; }
  }
  const uri = await uploadIpfs({ name: row.name, symbol: row.symbol, description: row.description, imageBuffer, imageMime, twitter: row.twitter, telegram: row.telegram, website });

  // 2. create_v2 quoted in the parent coin, with the pump-coin quote accounts (Q's curve/pool + every coin
  //    below Q), carrying the tax; creator = this wallet = the engine. ~200k CU + the ATA it creates.
  const createIx = await buildCreate({ mint: mintKp.publicKey, name: row.name, symbol: row.symbol, uri, creator: wallet.publicKey, user: wallet.publicKey, quote, taxBps: Number(row.creator_tax_bps) });
  const sig = await sendTx({ instructions: [createIx], payer: wallet.publicKey, signers: [wallet, mintKp], computeUnits: 400_000 });
  const chain = [...parent.chain, parent.mint];
  await sql`update coins set mint = ${mint}, launch_tx = ${sig}, launched_at = now(), website = ${website}, depth = ${quote.depth}, chain = ${JSON.stringify(chain)}, quote_mint = ${parent.mint}, quote_decimals = ${quote.decimals}, quote_token_program = ${quote.tokenProgram.toBase58()} where launch_id = ${row.launch_id}`;
  console.log(`[launch] $${row.symbol} created: ${mint} (${sig}) · depth ${quote.depth} · chain SOL → ${chain.map((m) => "$" + (coins.get(m)?.symbol || m.slice(0, 4))).join(" → ")} → $${row.symbol}`);

  // 3. dev buy: one multi_hop_swap from SOL up the chain into the new coin (SOL → $L1 → … → parent → coin),
  //    tokens → the user's wallet. Three hops fit a legacy tx (depth ≤ 2); deeper would need a lookup table.
  const programId = await mintProgramId(mint);
  const devBuySol = Number(row.dev_buy_sol);
  if (devBuySol > 0) {
    const balance = await connection.getBalance(wallet.publicKey);
    const lamports = BigInt(Math.min(Math.round(devBuySol * LAMPORTS), Math.max(0, balance - Math.round(config.rules.gasReserveSol * LAMPORTS) - 3_000_000)));
    const path = [WSOL_MINT, ...chain, mint];
    let bought = false;
    if (path.length - 1 > 3) {
      await sql`update coins set error = 'dev buy skipped: a route of more than 3 hops needs a lookup table — the SOL stays as the coin wallet gas reserve' where launch_id = ${row.launch_id}`;
      console.warn(`[launch] $${row.symbol}: ${path.length - 1} hops, dev buy skipped`);
    } else if (lamports > 0n) {
      for (let attempt = 1; attempt <= 3 && !bought; attempt++) {
        try {
          const { sig: b, hops } = await multiHopBuy({ wallet, path, lamports });
          await sql`update coins set dev_buy_tx = ${b} where launch_id = ${row.launch_id}`;
          console.log(`[launch] dev buy ${Number(lamports) / LAMPORTS} SOL → $${row.symbol} in ${hops} hops · ${b}`);
          bought = true;
        } catch (err) {
          console.error(`[launch] $${row.symbol} dev buy attempt ${attempt} failed:`, String(err.message).slice(0, 220));
          await new Promise((r) => setTimeout(r, 2500));
        }
      }
      if (bought) {
        await tokenBalanceRawSettled(wallet.publicKey.toBase58(), mint, programId);
        const { sig: t, amount } = await transferAllTokens({ wallet, mint, to: row.user_wallet, programId });
        await sql`update coins set dev_transfer_tx = ${t} where launch_id = ${row.launch_id}`;
        console.log(`[launch] ${Number(amount) / 1e6} $${row.symbol} → ${row.user_wallet} (${t})`);
      } else {
        // the coin exists but the dev buy did not: the SOL above the gas reserve goes straight back — it is the user's, not fees
        const bal = await connection.getBalance(wallet.publicKey);
        const back = bal - Math.round(config.rules.gasReserveSol * LAMPORTS) - 2_000_000;
        if (back > 0) {
          const r = await sendTx({ instructions: [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(row.user_wallet), lamports: back })], payer: wallet.publicKey, signers: [wallet], computeUnits: 10_000 });
          await sql`update coins set dev_transfer_tx = ${r}, error = 'dev buy failed — the SOL was returned to your wallet' where launch_id = ${row.launch_id}`;
          console.error(`[launch] $${row.symbol} dev buy gave up — returned ${(back / LAMPORTS).toFixed(4)} SOL to ${row.user_wallet} (${r})`);
        }
      }
    }
  }

  // 4. place it on the stack and go live
  const curve = await loadCurve(mint).catch(() => null);
  const supply = await totalSupply(mint).catch(() => 1e9);
  const walletSol = await getSolBalance(wallet.publicKey.toBase58()).catch(() => 0);
  await sql`update coins set token_program = ${programId.toBase58()}, created_ts_ms = ${Date.now()}, depth = ${curve?.depth || quote.depth}, graduated = false,
    supply0 = ${supply}, supply = ${supply}, pot_wallet_sol = ${walletSol}, status = 'live' where launch_id = ${row.launch_id}`;
  console.log(`[launch] $${row.symbol} live ✅ depth ${curve?.depth ?? quote.depth} · ${walletSol.toFixed(4)} SOL left as the engine's gas reserve`);
  await onCoinLive(mint);
}

/// Admin recovery: send the coin tokens sitting in a coin's engine wallet to its deployer's wallet.
export async function deliverToUser(mint) {
  const [row] = await sql`select * from coins where mint = ${mint}`;
  if (!row || row.is_root) throw new Error("unknown coin");
  const wallet = keypairFromSecret(decryptSecret(row.wallet_secret_enc));
  const programId = await mintProgramId(mint);
  const t = await transferAllTokens({ wallet, mint, to: row.user_wallet, programId });
  await sql`update coins set dev_transfer_tx = ${t.sig || row.dev_transfer_tx} where mint = ${mint}`;
  return { mint, user: row.user_wallet, wallet: row.wallet, tokens: { amount: Number(t.amount) / 1e6, tx: t.sig } };
}

/// Admin: every launch row with what its custodial wallet still holds — finds deposits that never became a coin.
export async function auditLaunches() {
  const rows = await sql`select launch_id, status, symbol, name, wallet, user_wallet, mint, parent_mint, depth, dev_buy_sol, deposit_expected_sol, error, refund_tx, created_at, is_root from coins order by created_at`;
  const out = [];
  for (const r of rows) {
    const sol = await getSolBalance(r.wallet).catch(() => null);
    out.push({ launchId: r.launch_id, status: r.status, symbol: r.symbol, name: r.name, wallet: r.wallet, userWallet: r.user_wallet, mint: r.mint, parent: r.parent_mint, depth: r.depth, devBuySol: Number(r.dev_buy_sol), expectedSol: Number(r.deposit_expected_sol), error: r.error, refundTx: r.refund_tx, createdAt: r.created_at, isL1: r.is_root, walletSol: sol, stuck: r.status !== "live" && !r.is_root && (sol || 0) > 0.001 });
  }
  return out;
}

/// Admin: send everything in a NOT-live launch's wallet back to the wallet that paid for it.
export async function adminRefund(launchId) {
  const [row] = await sql`select * from coins where launch_id = ${launchId}`;
  if (!row) throw new Error("unknown launch");
  if (row.status === "live" || row.is_root) throw new Error("this launch is live — its wallet is the coin's engine, not a deposit");
  if (row.status === "launching") throw new Error("launch in progress — wait for it to finish or fail");
  await refundDeposit(row);
  const [after] = await sql`select status, refund_tx from coins where launch_id = ${launchId}`;
  return { launchId, user: row.user_wallet, wallet: row.wallet, status: after.status, refundTx: after.refund_tx };
}

export { pathFromSol };
