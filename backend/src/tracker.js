import { PublicKey } from "@solana/web3.js";
import { config } from "./config.js";
import { sql } from "./db.js";
import { getSolUsd, getSolBalance } from "./solana.js";
import { loadCurve, curvePriceInQuote, poolPriceInQuote, creatorFeesRaw, totalSupply, tokenBalanceRaw, quoteBalance, fetchCoinInfo, fromRaw, pumpGlobals, maxDepthAllowed, DECIMALS } from "./pumpfun.js";
import { coins, liveCoins, quoteOf, usdOfQuote } from "./stack.js";

/// The tracker. Every POLL_SEC it walks the stack from $L1 up (a coin's USD price is its price
/// in its quote × the quote's USD price, so parents go first) and refreshes, per coin: the curve
/// (graduation, depth, the v3 creator bucket), the price, the supply, the pot (creator fees waiting +
/// what sits in the engine wallet) and a price sample. Nested coins are on no candle API: the chain
/// is the only oracle, and it is enough.

export const market = { solUsd: 0, updatedAt: 0, maxCurveDepth: 0, maxDepthAllowed: 0, taxGate: null, error: null };
let running = false, ticks = 0;

export async function startTracker() {
  await tick();
  setInterval(tick, config.pollSec * 1000);
  console.log(`[tracker] ${liveCoins().length} coins · SOL $${market.solUsd} · pump.fun max depth ${market.maxCurveDepth} (we allow ${market.maxDepthAllowed}) · polling every ${config.pollSec}s`);
}

/// Spendable fees of a coin right now (UI units of its quote): unclaimed + what the wallet holds − the ops debt.
export const fuelOf = (c) => Math.max(0, (c.pot.unclaimed || 0) + (c.isL1 ? Math.max(0, (c.pot.walletSol || 0) - config.rules.gasReserveSol) : (c.pot.walletQuote || 0)) - (c.opsOwedQuote || 0));

async function tick() {
  if (running) return;
  running = true; ticks++;
  try {
    market.solUsd = (await getSolUsd()) || market.solUsd;
    try { const g = await pumpGlobals(); market.maxCurveDepth = g.maxCurveDepth; market.maxDepthAllowed = await maxDepthAllowed(); market.taxGate = { enabled: Boolean(g.global.creatorFeeConfigurable), maxBps: Number(g.global.maxConfigurableCreatorFeeBps?.toString?.() ?? 0) }; market.error = null; }
    catch (e) { market.error = String(e.message).slice(0, 120); }
    market.updatedAt = Math.floor(Date.now() / 1000);
    const list = liveCoins().sort((a, b) => a.depth - b.depth);
    for (const c of list) await refreshCoin(c, ticks).catch((e) => { c.pot.error = String(e.message).slice(0, 120); });
  } catch (err) {
    console.error("[tracker] tick:", String(err.message).slice(0, 200));
  } finally { running = false; }
}

export async function refreshCoin(c, t = 0) {
  const quote = quoteOf(c);
  const curve = await loadCurve(c.mint);
  c.graduated = curve.complete || c.graduated;
  c.depth = curve.depth || c.depth;
  c.taxBps = curve.taxBps || c.taxBps;
  c.creatorBucket = fromRaw(curve.creatorBucketRaw, quote.decimals);
  // price in the quote, from the curve or the pool
  if (!c.graduated) c.priceQuote = curvePriceInQuote(curve, quote.decimals);
  else { const p = await poolPriceInQuote(c.mint, quote).catch(() => null); if (p) { c.priceQuote = p.price; c.pool = p.pool; } }
  c.priceUsd = c.priceQuote * usdOfQuote(c, market.solUsd);
  c.mcapUsd = c.priceUsd * 1e9;                      // pump.fun's convention: price × the 1B mint supply
  c.priceUpdatedAt = Math.floor(Date.now() / 1000);
  // supply (every 4th tick — burns move it) and the pot
  if (t % 4 === 1 || !c.supply) { c.supply = await totalSupply(c.mint).catch(() => c.supply); c.burned = Math.max(0, c.supply0 - c.supply); }
  const [fees, walletSol, walletQuote, walletTokens] = await Promise.all([
    creatorFeesRaw(c.wallet, quote, curve).catch(() => null),
    getSolBalance(c.wallet).catch(() => c.pot.walletSol),
    c.isL1 ? Promise.resolve(0) : quoteBalance(c.wallet, quote).catch(() => c.pot.walletQuote),
    tokenBalanceRaw(c.wallet, c.mint, new PublicKey(c.tokenProgram || "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")).then((r) => fromRaw(r, DECIMALS)).catch(() => c.pot.walletTokens),
  ]);
  if (fees) { c.pot.unclaimed = fromRaw(fees.total, quote.decimals); c.pot.error = null; }
  c.pot.walletSol = walletSol; c.pot.walletQuote = walletQuote; c.pot.walletTokens = walletTokens; c.pot.updatedAt = Math.floor(Date.now() / 1000);
  // optional colour from DexScreener (volume, a canonical image when we have none) — every ~minute
  if (t % 5 === 2) {
    const info = await fetchCoinInfo(c.mint).catch(() => null);
    if (info) { c.volume24hUsd = info.volume24hUsd || c.volume24hUsd; if (!c.image && info.image) c.image = info.image; if (!c.createdTs && info.createdTs) c.createdTs = info.createdTs; }
  }
  await sql`update coins set graduated = ${c.graduated}, pool = ${c.pool || ""}, depth = ${c.depth}, creator_tax_bps = ${c.taxBps}, price_quote = ${c.priceQuote}, price_usd = ${c.priceUsd}, mcap_usd = ${c.mcapUsd}, price_updated_at = ${c.priceUpdatedAt},
    supply = ${c.supply}, burned = ${c.burned}, volume24h_usd = ${c.volume24hUsd || 0}, image = ${c.image || ""}, created_ts_ms = ${c.createdTs || 0},
    pot_unclaimed = ${c.pot.unclaimed}, pot_wallet_quote = ${c.pot.walletQuote}, pot_wallet_sol = ${c.pot.walletSol}, pot_wallet_tokens = ${c.pot.walletTokens}, pot_updated_at = ${c.pot.updatedAt} where mint = ${c.mint}`;
  if (c.priceUsd > 0 && t % 2 === 0) {
    const ts = Math.floor(Date.now() / 1000);
    await sql`insert into samples (mint, ts, price_usd, mcap_usd) values (${c.mint}, ${ts}, ${c.priceUsd}, ${c.mcapUsd}) on conflict do nothing`;
    if (t % 40 === 0) await sql`delete from samples where mint = ${c.mint} and ts < ${ts - 14 * 86400}`;
  }
  return c;
}

export { coins };
