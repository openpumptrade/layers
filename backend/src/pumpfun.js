import { createRequire } from "node:module";
import BN from "bn.js";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createBurnCheckedInstruction,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { config } from "./config.js";
import { connection, sendTx, simulate, LAMPORTS, WSOL_MINT } from "./solana.js";

// the SDKs' ESM builds break on Node (bad named imports from @coral-xyz/anchor) — their CJS builds work
const require = createRequire(import.meta.url);
const {
  PumpSdk, OnlinePumpSdk, PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, QUOTE_CONTROL_PDA, MAX_CURVE_DEPTH,
  bondingCurvePda, canonicalPumpPoolPdaWithQuote, normalizeQuoteMint,
  getBuyV3TokenAmountFromQuoteAmount, getBuyTokenAmountFromSolAmount,
} = require("@pump-fun/pump-sdk");
const { OnlinePumpAmmSdk, PUMP_AMM_SDK } = require("@pump-fun/pump-swap-sdk");

export const sdk = new PumpSdk();
export const online = new OnlinePumpSdk(connection);
export const amm = new OnlinePumpAmmSdk(connection);
export const DECIMALS = 6;            // every pump.fun coin
export const PROGRAM_MAX_DEPTH = Number(MAX_CURVE_DEPTH || 5);
export { PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, QUOTE_CONTROL_PDA, bondingCurvePda, canonicalPumpPoolPdaWithQuote, BN, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, NATIVE_MINT, getAssociatedTokenAddressSync };

const UA = { accept: "application/json", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36" };
export const toRaw = (ui, decimals) => BigInt(Math.floor(ui * 10 ** decimals));
export const fromRaw = (raw, decimals) => Number(raw) / 10 ** decimals;
const bn = (big) => new BN(big.toString());
const big = (b) => BigInt(b.toString());
export const pk = (x) => (x instanceof PublicKey ? x : new PublicKey(x));

// ----------------------------------------------------------------- helpers
const programCache = new Map();
/// pump.fun mints are Token-2022 nowadays, older ones classic SPL — never assume, read the mint's owner.
export async function mintProgramId(mint) {
  const key = String(mint);
  if (programCache.has(key)) return programCache.get(key);
  const info = await connection.getAccountInfo(pk(mint));
  if (!info) throw new Error(`mint ${mint} not found on chain`);
  const pid = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  programCache.set(key, pid);
  return pid;
}

export async function totalSupply(mint) {
  const s = await connection.getTokenSupply(pk(mint));
  return Number(s.value.uiAmount ?? Number(s.value.amount) / 10 ** s.value.decimals);
}

export const isSolQuote = (q) => !q || q.equals?.(PublicKey.default) || String(q) === WSOL_MINT;

let globalCache = { at: 0 };
/// pump.fun's Global + FeeConfig + QuoteControl, 60 s cache. `maxCurveDepth` is the depth gate pump.fun
/// has set on chain (2 since Oct 13 — depth-2 coins can be paired with depth-1 coins).
export async function pumpGlobals() {
  if (Date.now() - globalCache.at < 60_000 && globalCache.global) return globalCache;
  const [global, feeConfig, quoteControl] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig(), online.fetchQuoteControl().catch(() => null)]);
  globalCache = { at: Date.now(), global, feeConfig, quoteControl, maxCurveDepth: Number(global.maxCurveDepth ?? 0) };
  return globalCache;
}
/// How deep the tree may grow right now: pump.fun's gate, capped by MAX_DEPTH when set, and by the program's 5.
export async function maxDepthAllowed() {
  const { maxCurveDepth } = await pumpGlobals();
  const chain = Math.min(PROGRAM_MAX_DEPTH, maxCurveDepth);
  return config.maxDepth > 0 ? Math.min(config.maxDepth, chain) : chain;
}

// ------------------------------------------------------------- quote assets
export const SOL_QUOTE = { mint: WSOL_MINT, isSol: true, tokenProgram: TOKEN_PROGRAM_ID, decimals: 9, symbol: "SOL", name: "Solana", source: "sol", depth: 0, pumpQuote: null };

/// What a coin can be quoted in. SOL, a listed mint (Global / quote-control), or — the whole point of
/// this launchpad — a PUMP COIN already on its curve or pool (`source: "pumpCoin"`): the SDK walks Q's
/// quote chain down to its depth-0 root and hands back the remaining accounts `create_v2` needs
/// (Q's curve + pool, then one group per coin below Q) and the depth the new coin will get.
export async function resolveQuote(quoteMint) {
  if (isSolQuote(quoteMint)) return SOL_QUOTE;
  const mint = pk(quoteMint);
  const r = await online.resolveQuoteMint(mint); // throws UnsupportedQuoteMint / CurveDepthExceeded / QuoteCurveAwaitingMigration…
  const isPump = r.source === "pumpCoin";
  return {
    mint: mint.toBase58(), isSol: false, tokenProgram: r.quoteTokenProgram, decimals: Number(r.decimals ?? 6),
    symbol: "", name: "", source: r.source,
    depth: isPump ? Number(r.pumpQuote.depth) : 0,                 // depth of a coin created on this quote
    pumpQuote: isPump ? r.pumpQuote : null,                          // {curve, accounts, depth}
    initialVirtualQuoteReserves: r.initialVirtualQuoteReserves ? big(r.initialVirtualQuoteReserves) : null,
  };
}

/// The coin's curve: quote (normalized), creator, tax, depth, graduation, the v3 creator bucket.
export async function loadCurve(mint) {
  const info = await connection.getAccountInfo(bondingCurvePda(pk(mint)));
  if (!info || !info.owner.equals(PUMP_PROGRAM_ID)) throw new Error(`${String(mint).slice(0, 8)}… has no pump.fun bonding curve`);
  const bc = sdk.decodeBondingCurve(info);
  const quoteMintPk = isSolQuote(bc.quoteMint) ? new PublicKey(WSOL_MINT) : bc.quoteMint;
  return {
    bondingCurve: bc, quoteMintPk, quoteIsSol: isSolQuote(bc.quoteMint), creator: bc.creator.toBase58(), complete: Boolean(bc.complete),
    taxBps: Number(bc.creatorFeeBps?.toString?.() ?? 0), isHolderReward: Boolean(bc.isHolderReward), isMayhem: Boolean(bc.isMayhemMode),
    depth: Number(bc.depth ?? 0), creatorBucketRaw: big(bc.creatorFee ?? 0), tokenTotalSupply: bc.tokenTotalSupply,
    virtualTokenReserves: big(bc.virtualTokenReserves), virtualQuoteReserves: big(bc.virtualQuoteReserves),
    realTokenReserves: big(bc.realTokenReserves), realQuoteReserves: big(bc.realQuoteReserves),
  };
}

/// The coin's whole quote chain read from the chain itself: [root … parent], each with its depth.
/// Walks `BondingCurve.quote_mint` down until it hits SOL / a listed mint (depth 0).
export async function readChain(mint) {
  const out = [];
  let cur = await loadCurve(mint);
  let guard = 0;
  while (!cur.quoteIsSol && guard++ < PROGRAM_MAX_DEPTH + 1) {
    const q = cur.quoteMintPk;
    const info = await connection.getAccountInfo(bondingCurvePda(q));
    if (!info || !info.owner.equals(PUMP_PROGRAM_ID)) break; // quoted in a listed non-pump mint (USDC, an xStock…)
    const c = sdk.decodeBondingCurve(info);
    out.unshift(q.toBase58());
    cur = { quoteMintPk: isSolQuote(c.quoteMint) ? new PublicKey(WSOL_MINT) : c.quoteMint, quoteIsSol: isSolQuote(c.quoteMint) };
  }
  return out;
}

// ----------------------------------------------------------------- prices
/// Price of the coin in its quote, from the curve's virtual reserves (6-decimal coin, `quoteDecimals` quote).
export function curvePriceInQuote(curve, quoteDecimals) {
  const t = Number(curve.virtualTokenReserves) / 10 ** DECIMALS, q = Number(curve.virtualQuoteReserves) / 10 ** quoteDecimals;
  return t > 0 ? q / t : 0;
}
/// Price of a graduated coin in its quote, from its canonical PumpSwap pool's vaults.
export async function poolPriceInQuote(mint, quote) {
  const poolPk = canonicalPumpPoolPdaWithQuote(pk(mint), quote.isSol ? NATIVE_MINT : pk(quote.mint));
  const st = await amm.swapSolanaState(poolPk, PublicKey.default);
  const base = Number(st.poolBaseAmount) / 10 ** DECIMALS, q = Number(st.poolQuoteAmount) / 10 ** quote.decimals;
  return { pool: poolPk.toBase58(), price: base > 0 ? q / base : 0, baseReserve: base, quoteReserve: q };
}

// ------------------------------------------------------ pump.fun public data
const SWAP_API = "https://swap-api.pump.fun";
/// Optional colour: DexScreener indexes pump.fun curves and PumpSwap pools (any quote) within seconds of
/// the first trade. Used for volume / image fallback only — prices come from the chain (tracker.js).
export async function fetchCoinInfo(mint) {
  const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { headers: UA, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`dexscreener → ${res.status}`);
  const pairs = (await res.json()).filter((p) => p.chainId === "solana" && p.baseToken?.address === mint);
  if (!pairs.length) throw new Error("not indexed yet");
  const pool = pairs.find((p) => p.dexId === "pumpswap"), curve = pairs.find((p) => p.dexId === "pumpfun");
  const main = pool || curve || pairs[0];
  return { mint, name: main.baseToken?.name || "", symbol: main.baseToken?.symbol || "", image: main.info?.imageUrl || "", priceUsd: Number(main.priceUsd || 0), volume24hUsd: Number(main.volume?.h24 || 0), complete: pool ? true : undefined, pool: pool ? pool.pairAddress : "", createdTs: Number((curve || main).pairCreatedAt || 0) };
}
export async function fetchTrades(mint, limit = 50) {
  const res = await fetch(`${SWAP_API}/v2/coins/${mint}/trades?limit=${limit}`, { headers: UA, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`trades → ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : (json.trades ?? json.data ?? []);
}

// -------------------------------------------------------- metadata on IPFS
export async function uploadIpfs({ name, symbol, description, imageBuffer, imageMime, twitter, telegram, website }) {
  const form = new FormData();
  form.append("file", new Blob([imageBuffer], { type: imageMime }), "coin.png");
  form.append("name", name);
  form.append("symbol", symbol);
  form.append("description", description || "");
  if (twitter) form.append("twitter", twitter);
  if (telegram) form.append("telegram", telegram);
  if (website) form.append("website", website);
  form.append("showName", "true");
  const res = await fetch("https://pump.fun/api/ipfs", { method: "POST", body: form, headers: { "user-agent": UA["user-agent"] }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`IPFS upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  if (!j.metadataUri) throw new Error("IPFS upload returned no metadata URI");
  return j.metadataUri;
}

// ------------------------------------------------- balances / transfers / burns
export async function tokenBalanceRaw(owner, mint, programId) {
  const ata = getAssociatedTokenAddressSync(pk(mint), pk(owner), false, programId);
  try { return BigInt((await connection.getTokenAccountBalance(ata)).value.amount); } catch { return 0n; }
}
/// Right after a buy the RPC can still return the old balance — a few retries.
export async function tokenBalanceRawSettled(owner, mint, programId, above = 0n, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const v = await tokenBalanceRaw(owner, mint, programId);
    if (v > above) return v;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return tokenBalanceRaw(owner, mint, programId);
}
/// Balance of a quote asset in UI units (SOL or the token).
export async function quoteBalance(owner, quote) {
  if (quote.isSol) return (await connection.getBalance(pk(owner))) / LAMPORTS;
  return fromRaw(await tokenBalanceRaw(owner, quote.mint, quote.tokenProgram), quote.decimals);
}
export async function transferTokens({ wallet, mint, to, programId, amountRaw, decimals = DECIMALS }) {
  if (amountRaw <= 0n) return { sig: "", amount: 0n };
  const mintPk = pk(mint), toPk = pk(to);
  const from = getAssociatedTokenAddressSync(mintPk, wallet.publicKey, false, programId);
  const dest = getAssociatedTokenAddressSync(mintPk, toPk, true, programId);
  const instructions = [createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, dest, toPk, mintPk, programId), createTransferCheckedInstruction(from, mintPk, dest, wallet.publicKey, amountRaw, decimals, [], programId)];
  const sig = await sendTx({ instructions, payer: wallet.publicKey, signers: [wallet], computeUnits: 80_000 });
  return { sig, amount: amountRaw };
}
export async function transferAllTokens({ wallet, mint, to, programId, decimals = DECIMALS }) {
  const amount = await tokenBalanceRaw(wallet.publicKey.toBase58(), mint, programId);
  return transferTokens({ wallet, mint, to, programId, amountRaw: amount, decimals });
}
/// Burn EXACTLY `amountRaw` — never "everything the wallet holds" (the engine wallet may hold a dev bag in transit).
export async function burnTokens({ wallet, mint, programId, amountRaw, decimals = DECIMALS }) {
  if (amountRaw <= 0n) return { sig: "", amount: 0n };
  const mintPk = pk(mint);
  const ata = getAssociatedTokenAddressSync(mintPk, wallet.publicKey, false, programId);
  const instructions = [createBurnCheckedInstruction(ata, mintPk, wallet.publicKey, amountRaw, decimals, [], programId)];
  const sig = await sendTx({ instructions, payer: wallet.publicKey, signers: [wallet], computeUnits: 80_000 });
  return { sig, amount: amountRaw };
}

// ------------------------------------------------------------- creator fees
function vaultPdas(creatorPk) {
  const [creatorVault] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), creatorPk.toBuffer()], PUMP_PROGRAM_ID);
  const [ammVaultAuth] = PublicKey.findProgramAddressSync([Buffer.from("creator_vault"), creatorPk.toBuffer()], PUMP_AMM_PROGRAM_ID);
  return { creatorVault, ammVaultAuth };
}
/// Creator fees waiting for `creator` in the coin's quote: the pump vault + the PumpSwap vault (already
/// swept) and the v3 bucket still sitting on the curve (`BondingCurve.creator_fee`, swept by anyone).
export async function creatorFeesRaw(creator, quote, curve) {
  const creatorPk = pk(creator);
  let vault = 0n, ammv = 0n;
  if (quote.isSol) {
    vault = big(await online.getCreatorVaultBalanceBothPrograms(creatorPk));
  } else {
    const quoteMint = pk(quote.mint);
    const { creatorVault, ammVaultAuth } = vaultPdas(creatorPk);
    const read = async (owner) => { try { return BigInt((await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(quoteMint, owner, true, quote.tokenProgram))).value.amount); } catch { return 0n; } };
    [vault, ammv] = await Promise.all([read(creatorVault), read(ammVaultAuth)]);
  }
  const bucket = curve ? curve.creatorBucketRaw : 0n;
  return { vault, amm: ammv, bucket, total: vault + ammv + bucket };
}

/// Instructions that move everything pump.fun owes the creator into the creator's wallet / quote ATA:
/// sweep the v3 curve bucket (+ the pool bucket after graduation), then collect from both vaults.
export async function claimInstructions({ creatorPk, mint, quote, curve, graduated, withPoolSweep = true, withCurveSweep = true }) {
  const ixs = [];
  const quoteMint = quote.isSol ? NATIVE_MINT : pk(quote.mint);
  if (withCurveSweep && curve && curve.creatorBucketRaw > 0n) ixs.push(await sdk.sweepCreatorFeeInstruction({ payer: creatorPk, mint: pk(mint), creator: creatorPk, quoteMint, quoteTokenProgram: quote.tokenProgram }));
  if (withPoolSweep && graduated) ixs.push(await sdk.sweepPoolCreatorFeeInstruction({ payer: creatorPk, mint: pk(mint), coinCreator: creatorPk, quoteMint, quoteTokenProgram: quote.tokenProgram }));
  if (quote.isSol) ixs.push(...(await online.collectCoinCreatorFeeInstructions(creatorPk, creatorPk)));
  else {
    const ata = getAssociatedTokenAddressSync(quoteMint, creatorPk, false, quote.tokenProgram);
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(creatorPk, ata, creatorPk, quoteMint, quote.tokenProgram));
    ixs.push(...(await online.collectCoinCreatorFeeV2Instructions(creatorPk, quoteMint, quote.tokenProgram, creatorPk)));
  }
  return ixs;
}
/// Claim with graceful degradation: an empty pool bucket can make the pool sweep fail the simulation —
/// retry without it, then without the curve sweep.
export async function claimCreatorFees({ wallet, mint, quote, curve, graduated }) {
  const attempts = [{ withPoolSweep: true, withCurveSweep: true }, { withPoolSweep: false, withCurveSweep: true }, { withPoolSweep: false, withCurveSweep: false }];
  let lastErr = null;
  for (const a of attempts) {
    if (!a.withPoolSweep && !graduated && a.withCurveSweep) continue;
    try {
      const instructions = await claimInstructions({ creatorPk: wallet.publicKey, mint, quote, curve, graduated, ...a });
      if (!instructions.length) return { sig: "" };
      const sig = await sendTx({ instructions, payer: wallet.publicKey, signers: [wallet], computeUnits: 300_000 });
      return { sig };
    } catch (err) { lastErr = err; if (!/simulation failed/i.test(String(err.message))) throw err; }
  }
  throw lastErr;
}

// ---------------------------------------------------------------- creating
/// create_v2 for a coin paired with SOL, a listed quote, or a PUMP COIN on the tree (`quote.pumpQuote`
/// carries Q's curve/pool and one account group per coin below Q — that is the depth-1 / depth-2 path).
/// `taxBps` is the coin's own creator fee (custom pairs only; pump.fun ignores it on SOL/USDC).
export async function buildCreate({ mint, name, symbol, uri, creator, user, quote = SOL_QUOTE, taxBps = 0 }) {
  if (Buffer.byteLength(symbol) > config.symbolMax) throw new Error(`ticker over ${config.symbolMax} bytes`);
  const args = { mint: pk(mint), name, symbol, uri, creator: pk(creator), user: pk(user), mayhemMode: false };
  if (quote.isSol) return sdk.createV2Instruction(args);
  return sdk.createV2Instruction({ ...args, quoteMint: pk(quote.mint), quoteTokenProgram: quote.tokenProgram, creatorFeeBps: taxBps ? new BN(taxBps) : undefined, pumpQuote: quote.pumpQuote ? quote.pumpQuote.accounts : undefined });
}
/// Free dry run from any funded payer (sigVerify off) — catches SymbolTooLong, CurveDepthExceeded & co. before spending.
export async function simulateCreate({ mint, name, symbol, uri = "https://pump.fun", payer, quote = SOL_QUOTE, taxBps = 0 }) {
  const ix = await buildCreate({ mint, name, symbol, uri, creator: payer, user: payer, quote, taxBps });
  return simulate({ instructions: [ix], payer, computeUnits: 400_000 });
}
/// The tax gate as pump.fun has it on chain right now.
export async function taxConfig() {
  const { global } = await pumpGlobals();
  return { enabled: Boolean(global.creatorFeeConfigurable), maxBps: Number(global.maxConfigurableCreatorFeeBps?.toString?.() ?? 0) };
}

// ------------------------------------------------------------------ buys
/// ONE buy on the bonding curve with `buy_exact_quote_in_v3`: spends exactly `quoteAmountRaw` of the quote
/// (lamports for SOL, the parent coin's raw units otherwise). Works for any quote, SOL or pump coin.
export async function curveBuy({ wallet, mint, quote = SOL_QUOTE, quoteAmountRaw, programId, slippagePct = config.rules.slippagePct }) {
  const mintPk = pk(mint);
  programId = programId || (await mintProgramId(mint));
  const { global, feeConfig } = await pumpGlobals();
  const st = await online.fetchBuyState(mintPk, wallet.publicKey, programId, quote.isSol ? undefined : pk(quote.mint));
  if (st.bondingCurve.complete) throw new Error("graduated");
  const quoteAmount = bn(quoteAmountRaw);
  const amount = getBuyV3TokenAmountFromQuoteAmount({ global, feeConfig, mintSupply: st.bondingCurve.tokenTotalSupply, bondingCurve: st.bondingCurve, amount: quoteAmount, curveBaseTokenBalance: st.curveBaseTokenBalance });
  const instructions = await sdk.buyExactQuoteInV3Instructions({ bondingCurve: st.bondingCurve, associatedUserAccountInfo: st.associatedUserAccountInfo, mint: mintPk, user: wallet.publicKey, amount, quoteAmount, slippage: slippagePct, tokenProgram: programId, quoteTokenProgram: st.quoteTokenProgram });
  const sig = await sendTx({ instructions, payer: wallet.publicKey, signers: [wallet], computeUnits: 400_000 });
  return { sig, expectedTokensRaw: big(amount), venue: "curve" };
}
/// Tokens `quoteAmountRaw` buys on the curve right now (fees included). null when graduated.
export async function estimateCurveBuy(mint, quoteAmountRaw) {
  const { global, feeConfig } = await pumpGlobals();
  const st = await online.fetchBuyState(pk(mint), PublicKey.default, await mintProgramId(mint));
  if (st.bondingCurve.complete) return null;
  const amount = getBuyV3TokenAmountFromQuoteAmount({ global, feeConfig, mintSupply: st.bondingCurve.tokenTotalSupply, bondingCurve: st.bondingCurve, amount: bn(quoteAmountRaw), curveBaseTokenBalance: st.curveBaseTokenBalance });
  return fromRaw(big(amount), DECIMALS);
}
/// ONE buy on the coin's canonical PumpSwap pool (quote = SOL or the parent coin).
export async function pumpswapBuy({ wallet, mint, quote = SOL_QUOTE, quoteAmountRaw, slippagePct = config.rules.slippagePct }) {
  const poolPk = canonicalPumpPoolPdaWithQuote(pk(mint), quote.isSol ? NATIVE_MINT : pk(quote.mint));
  const state = await amm.swapSolanaState(poolPk, wallet.publicKey);
  const instructions = await PUMP_AMM_SDK.buyQuoteInput(state, bn(quoteAmountRaw), slippagePct);
  const sig = await sendTx({ instructions, payer: wallet.publicKey, signers: [wallet], computeUnits: 400_000 });
  return { sig, pool: poolPk.toBase58(), venue: "pumpswap" };
}
/// Curve while it trades, the pool after graduation.
export async function buyAny({ wallet, mint, quote, quoteAmountRaw, programId, graduated }) {
  if (!graduated) { try { return await curveBuy({ wallet, mint, quote, quoteAmountRaw, programId }); } catch (err) { if (!/graduated/i.test(String(err.message))) throw err; } }
  return pumpswapBuy({ wallet, mint, quote, quoteAmountRaw });
}

// ------------------------------------------------------------- multi-hop
/// pump-amm `multi_hop_swap`: buy a coin anywhere on the tree straight from SOL — SOL → $ROOT → branch → twig,
/// every hop on that coin's curve or pool. Three hops fit a legacy transaction (depth 2); deeper needs a
/// lookup table. `path` = [WSOL, …chain, mint].
export async function multiHopBuy({ wallet, path, lamports, slippagePct = config.rules.slippagePct }) {
  const hops = await online.resolveMultiHopRoute(path.map((m) => (isSolQuote(pk(m)) ? NATIVE_MINT : pk(m))), "buy");
  const amountIn = bn(lamports);
  const out = await online.simulateMultiHopSwap({ user: wallet.publicKey, hops, side: "buy", amountIn });
  const minAmountOut = out.muln(Math.round((100 - slippagePct) * 100)).divn(10_000);
  const instructions = await sdk.multiHopSwapInstructions({ user: wallet.publicKey, hops, side: "buy", amountIn, minAmountOut });
  const sig = await sendTx({ instructions, payer: wallet.publicKey, signers: [wallet], computeUnits: Math.min(1_400_000, 250_000 * hops.length + 150_000) });
  return { sig, hops: hops.length, expectedOutRaw: big(out) };
}
/// The reverse: sell a coin's quote (a coin on the tree) down the chain to SOL — used only to refill gas.
export async function multiHopSellToSol({ wallet, path, amountRaw, slippagePct = config.rules.slippagePct }) {
  const hops = await online.resolveMultiHopRoute(path.map((m) => (isSolQuote(pk(m)) ? NATIVE_MINT : pk(m))), "sell");
  const amountIn = bn(amountRaw);
  const out = await online.simulateMultiHopSwap({ user: wallet.publicKey, hops, side: "sell", amountIn });
  const minAmountOut = out.muln(Math.round((100 - slippagePct) * 100)).divn(10_000);
  const instructions = await sdk.multiHopSwapInstructions({ user: wallet.publicKey, hops, side: "sell", amountIn, minAmountOut });
  const sig = await sendTx({ instructions, payer: wallet.publicKey, signers: [wallet], computeUnits: Math.min(1_400_000, 250_000 * hops.length + 150_000) });
  return { sig, hops: hops.length, expectedOutRaw: big(out) };
}

// ----------------------------------------------------------------- jupiter
/// Jupiter, for the trunk only ($ROOT is a plain SOL pair): SOL → mint, or mint → SOL (gas refills).
async function jupiterSwap({ wallet, inputMint, outputMint, amountRaw }) {
  const bps = Math.round(config.rules.slippagePct * 100);
  const quoteRes = await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountRaw}&slippageBps=${bps}`, { signal: AbortSignal.timeout(15_000) });
  if (!quoteRes.ok) throw new Error(`jupiter quote → ${quoteRes.status}: ${(await quoteRes.text()).slice(0, 120)}`);
  const q = await quoteRes.json();
  const swapRes = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ quoteResponse: q, userPublicKey: wallet.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 2_000_000, priorityLevel: "high" } } }),
  });
  if (!swapRes.ok) throw new Error(`jupiter swap → ${swapRes.status}: ${(await swapRes.text()).slice(0, 120)}`);
  const { swapTransaction } = await swapRes.json();
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
  tx.sign([wallet]);
  const sig = await connection.sendTransaction(tx, { skipPreflight: true, maxRetries: 5 });
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return { sig, outAmount: BigInt(q.outAmount || 0), venue: "jupiter" };
}
export const jupiterSwapSolTo = ({ wallet, outMint, lamports }) => jupiterSwap({ wallet, inputMint: WSOL_MINT, outputMint: outMint, amountRaw: lamports });
export const jupiterSwapToSol = ({ wallet, inMint, amountRaw }) => jupiterSwap({ wallet, inputMint: inMint, outputMint: WSOL_MINT, amountRaw });

export { LAMPORTS, WSOL_MINT, getBuyTokenAmountFromSolAmount, normalizeQuoteMint };
