import { PublicKey } from "@solana/web3.js";
import { sql } from "./db.js";
import { config, mode } from "./config.js";
import { SOL_QUOTE, WSOL_MINT, loadCurve, readChain, mintProgramId, totalSupply } from "./pumpfun.js";

/// The stack, in memory: every live coin, its place (parent, depth, chain) and live numbers. Loaded from
/// the `coins` table at boot; the launcher adds coins as they go live. The base layer ($L1) is a row too
/// (is_root), registered from L1_MINT at boot — its key lives in the env, not in the table.

export const coins = new Map();                 // mint → coin
export const system = new Set(config.excludedWallets);
const listeners = [];
export function onNewCoin(fn) { listeners.push(fn); }

/// our own copy of the logo when the pad uploaded it; else pump.fun's gateway (ipfs.io rate-limits embeds)
export const imageUrl = (r) => (r.image_upload_id ? `${config.publicApiUrl}/api/uploads/${r.image_upload_id}` : String(r.image || "").replace("https://ipfs.io/ipfs/", "https://pump.mypinata.cloud/ipfs/"));

/// stack epoch by the USD value of fees settled so far — the drawn stack grows with it
export const LEVELS = [0, 50, 250, 1_000, 5_000, 25_000, 100_000, 500_000];
export const LEVEL_NAMES = ["genesis", "devnet", "testnet", "mainnet beta", "mainnet", "superchain", "hyperchain", "omnichain"];
/// …and by how many layers run on it: whichever is further along
export const LEVELS_COINS = [0, 1, 3, 6, 12, 25, 50, 100];
export function stackLevel(burnedUsd, coinCount) {
  const a = LEVELS.reduce((lv, t, i) => (burnedUsd >= t ? i + 1 : lv), 1);
  const b = LEVELS_COINS.reduce((lv, t, i) => (coinCount >= t ? i + 1 : lv), 1);
  return Math.max(a, b);
}

export function coinFromRow(r) {
  return {
    mint: r.mint, launchId: r.launch_id, isL1: Boolean(r.is_root), status: r.status, symbol: r.symbol, name: r.name, image: imageUrl(r), imageUploadId: r.image_upload_id || "",
    description: r.description, website: r.website, twitter: r.twitter, telegram: r.telegram, userWallet: r.user_wallet, wallet: r.wallet,
    parent: r.parent_mint || "", depth: Number(r.depth) || 0, chain: safeJson(r.chain, []),
    quoteMint: r.quote_mint || WSOL_MINT, quoteDecimals: Number(r.quote_decimals) || 6, quoteTokenProgram: r.quote_token_program || "",
    launchTx: r.launch_tx, launchedAt: r.launched_at ? Math.floor(new Date(r.launched_at).getTime() / 1000) : 0,
    devBuySol: Number(r.dev_buy_sol), creatorTaxBps: Number(r.creator_tax_bps),
    tokenProgram: r.token_program, createdTs: Number(r.created_ts_ms) || 0, pool: r.pool, graduated: Boolean(r.graduated),
    supply0: Number(r.supply0) || 1e9, supply: Number(r.supply) || Number(r.supply0) || 1e9, burned: Number(r.burned) || 0,
    priceQuote: Number(r.price_quote) || 0, priceUsd: Number(r.price_usd) || 0, mcapUsd: Number(r.mcap_usd) || 0, priceUpdatedAt: Number(r.price_updated_at),
    holders: Number(r.holders_est), volume24hUsd: Number(r.volume24h_usd),
    pot: { unclaimed: Number(r.pot_unclaimed), walletQuote: Number(r.pot_wallet_quote), walletSol: Number(r.pot_wallet_sol), walletTokens: Number(r.pot_wallet_tokens), updatedAt: Number(r.pot_updated_at), error: null },
    cyclesRun: Number(r.cycles_run), totalClaimedQuote: Number(r.total_claimed_quote), totalSelfQuote: Number(r.total_self_quote), totalSelfBurned: Number(r.total_self_burned), totalDownQuote: Number(r.total_down_quote), totalOpsQuote: Number(r.total_ops_quote), totalFeesUsd: Number(r.total_sap_usd), opsOwedQuote: Number(r.ops_owed_quote || 0),
    lastCycleAt: Number(r.last_cycle_at), lastNote: r.last_note, taxBps: Number(r.creator_tax_bps) || 0, creatorBucket: 0,
    progressState: null, // live cycle progress (settlement.js)
  };
}
const safeJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

/// The quote descriptor a coin trades in: SOL for $L1, the layer below otherwise.
export function quoteOf(c) {
  if (c.isL1 || !c.parent) return SOL_QUOTE;
  const p = coins.get(c.parent);
  return { mint: c.parent, isSol: false, tokenProgram: new PublicKey(c.quoteTokenProgram || p?.tokenProgram || "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"), decimals: c.quoteDecimals || 6, symbol: p ? p.symbol : "?", name: p ? p.name : "", source: "pumpCoin", depth: c.depth, pumpQuote: null };
}
export const l1Coin = () => [...coins.values()].find((c) => c.isL1) || null;
export const liveCoins = () => [...coins.values()].filter((c) => c.status === "live");
export const childrenOf = (mint) => liveCoins().filter((c) => c.parent === mint);
/// [L1 … parent] for a coin (what the SDK calls its quote chain, L1 first)
export const chainOf = (c) => (c.isL1 ? [] : c.chain);
/// the multi-hop buy path from SOL: [WSOL, L1, …, parent, mint]
export const pathFromSol = (c) => [WSOL_MINT, ...chainOf(c), c.mint];
/// the multi-hop sell path of a coin's QUOTE down to SOL: [parent, …, L1, WSOL]
export const quotePathToSol = (c) => [...chainOf(c)].reverse().concat(WSOL_MINT);
export const usdOfQuote = (c, solUsd) => (c.isL1 || !c.parent ? solUsd : coins.get(c.parent)?.priceUsd || 0);

export async function loadRegistry() {
  await registerL1();
  const rows = await sql`select * from coins where status = 'live' and mint is not null order by depth asc, launched_at asc`;
  for (const r of rows) {
    if (r.is_root && r.mint !== config.l1Mint) continue; // an L1 from an older L1_MINT is not ours any more
    const c = coinFromRow(r); coins.set(c.mint, c); system.add(c.wallet);
  }
  console.log(`[stack] ${coins.size} coins on the stack (${liveCoins().filter((c) => !c.isL1).length} layers + $L1)`);
  return coins;
}

/// $L1 becomes a row the first time the engine sees L1_MINT (or when the creator changes).
async function registerL1() {
  if (!config.l1Mint) return;
  const curve = await loadCurve(config.l1Mint);
  if (!curve.quoteIsSol) console.warn(`[stack] WARNING: L1_MINT is quoted in ${curve.quoteMintPk.toBase58()}, not SOL — $L1 should be a plain SOL pair`);
  if (curve.isHolderReward) console.warn("[stack] WARNING: $L1 is a holder-rewards coin — its creator fees go to holders, the L1 wallet cannot claim them");
  const wallet = mode() === "bot" ? config.l1Wallet.publicKey.toBase58() : curve.creator;
  if (mode() === "bot" && curve.creator && wallet !== curve.creator) console.warn(`[stack] WARNING: L1_WALLET_PRIVATE_KEY is ${wallet} but pump.fun pays the creator fees of $L1 to ${curve.creator} — claims will find nothing`);
  const [row] = await sql`select launch_id from coins where mint = ${config.l1Mint}`;
  const programId = (await mintProgramId(config.l1Mint)).toBase58();
  const supply = await totalSupply(config.l1Mint).catch(() => 1e9);
  if (!row) {
    await sql`insert into coins (launch_id, mint, status, is_root, wallet, user_wallet, name, symbol, parent_mint, depth, chain, quote_mint, quote_decimals, quote_token_program, creator_tax_bps, launched_at, token_program, graduated, supply0, supply)
      values (${"l1:" + config.l1Mint}, ${config.l1Mint}, 'live', true, ${wallet}, ${wallet}, ${"L1"}, ${"L1"}, '', 0, '[]', ${WSOL_MINT}, 9, ${"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"}, ${curve.taxBps}, now(), ${programId}, ${curve.complete}, ${supply}, ${supply})`;
    console.log(`[stack] genesis: $L1 ${config.l1Mint} · L1 wallet ${wallet}`);
  } else {
    await sql`update coins set wallet = ${wallet}, graduated = ${curve.complete}, token_program = ${programId}, status = 'live' where mint = ${config.l1Mint}`;
  }
}

export async function onCoinLive(mint) {
  const [r] = await sql`select * from coins where mint = ${mint}`;
  if (!r) return;
  const c = coinFromRow(r);
  coins.set(c.mint, c);
  system.add(c.wallet);
  for (const fn of listeners) { try { await fn(c); } catch (e) { console.error("[stack] listener:", e.message); } }
}

/// Verifies a coin's place in the stack against the chain (used by scripts and by the launcher after a create).
export async function placeOnStack(mint) {
  const chain = await readChain(mint);
  const curve = await loadCurve(mint);
  return { chain, depth: curve.depth || chain.length, parent: chain[chain.length - 1] || "", quoteIsSol: curve.quoteIsSol, curve };
}

/// Launchpad-wide numbers for the page.
export function stackStats() {
  const list = liveCoins();
  const layers = list.filter((c) => !c.isL1);
  const burnedUsd = list.reduce((s, c) => s + (c.totalFeesUsd || 0), 0);
  const byDepth = {};
  for (const c of layers) byDepth[c.depth] = (byDepth[c.depth] || 0) + 1;
  return { coins: layers.length, byDepth, maxDepthOnStack: layers.reduce((m, c) => Math.max(m, c.depth), 0), burnedUsd, level: stackLevel(burnedUsd, layers.length), levels: LEVELS, levelsCoins: LEVELS_COINS, levelNames: LEVEL_NAMES, mcapUsd: list.reduce((s, c) => s + (c.mcapUsd || 0), 0) };
}
