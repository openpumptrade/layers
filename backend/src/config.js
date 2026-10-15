import "dotenv/config";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

/// LAYERS — launch your L2 on a memecoin.
///
/// The stack: $L1 is the base layer, a standard pump.fun coin paired with SOL (depth 0). Every coin
/// launched here is created with pump.fun's `create_v2` quoted in a coin that is already on the stack:
/// an L2 is paired with $L1 (depth 1), an L3 with an L2 (depth 2), and so on as far as pump.fun's
/// `Global.max_curve_depth` allows. Every layer is born with a tax (CREATOR_TAX_BPS) paid in the layer
/// it runs on, and its creator is its own sequencer wallet.
///
/// The settlement — one clock, every CYCLE_INTERVAL_SEC, per coin:
///   1. sweep + claim 100% of the creator fees (SOL for $L1, the layer below for the rest)
///   2. SELF_SHARE  → one buy of the coin itself → burned
///      DOWN_SHARE  → the layer below is burned on the spot ("fees settle down"); $L1 has nothing
///                    below it, so for $L1 this share buys $L1 back and burns it too
///      OPS_SHARE   → the ops wallet (0 by default)
/// Nothing is ever sold. Every tx is in the ledger.

const num = (v, d) => (v === undefined || v === "" ? d : Number(v));
const bool = (v, d) => (v === undefined || v === "" ? d : String(v).toLowerCase() === "true");
const list = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);

/// bs58 (Phantom/Solflare export) or a JSON byte array. Anything else keeps $L1 in watch mode.
export function parseKeypair(raw) {
  const s = (raw || "").trim();
  if (!s) return null;
  try {
    if (s.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
    const bytes = bs58.decode(s);
    if (bytes.length !== 64) return null;
    return Keypair.fromSecretKey(bytes);
  } catch { return null; }
}

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || "postgres://localhost:5432/root",
  rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",

  brand: {
    name: process.env.BRAND_NAME || "LAYERS",
    siteUrl: (process.env.SITE_URL || "http://localhost:4000").replace(/\/$/, ""),
    twitter: process.env.BRAND_TWITTER || "",
    telegram: process.env.BRAND_TELEGRAM || "",
  },
  // where uploads / API are reachable from the outside (the logo goes to pump.fun's IPFS from here)
  publicApiUrl: (process.env.PUBLIC_API_URL || process.env.SITE_URL || "http://localhost:4000").replace(/\/$/, ""),

  // the base layer
  l1Mint: (process.env.L1_MINT || "").trim(),
  l1Wallet: parseKeypair(process.env.L1_WALLET_PRIVATE_KEY),

  // custody of the launched layers
  masterKey: (process.env.MASTER_KEY || "").trim(),
  creatorTaxBps: num(process.env.CREATOR_TAX_BPS, 100),
  maxDepth: num(process.env.MAX_DEPTH, 0),            // 0 = follow pump.fun's Global.max_curve_depth
  launchGasSol: num(process.env.LAUNCH_GAS_SOL, 0.06),
  maxDevBuySol: num(process.env.MAX_DEV_BUY_SOL, 10),
  depositTimeoutMin: num(process.env.DEPOSIT_TIMEOUT_MIN, 30),
  symbolMax: 13,                                        // pump.fun's on-chain limit (SymbolTooLong, 6044)

  // the split of every claimed pot, in bps
  split: {
    selfBps: num(process.env.SELF_SHARE_BPS, 5000),
    downBps: num(process.env.DOWN_SHARE_BPS, 5000),
    opsBps: num(process.env.OPS_SHARE_BPS, 0),
  },
  opsWallet: (process.env.OPS_WALLET || "").trim(),

  rules: {
    intervalSec: num(process.env.CYCLE_INTERVAL_SEC, 600),
    minClaimUsd: num(process.env.MIN_CLAIM_USD, 0.1),
    minSapUsd: num(process.env.MIN_SAP_USD, 0.25),
    gasReserveSol: num(process.env.GAS_RESERVE_SOL, 0.02),
    minGasSol: num(process.env.MIN_GAS_SOL, 0.004),
    gasRefillBelowSol: num(process.env.GAS_REFILL_BELOW_SOL, 0.012),
    gasRefillUsd: num(process.env.GAS_REFILL_USD, 1.5),
    slippagePct: num(process.env.SLIPPAGE_PCT, 5),
  },
  cycleConcurrency: num(process.env.CYCLE_CONCURRENCY, 3),
  excludedWallets: list(process.env.EXCLUDED_WALLETS),

  dryRun: bool(process.env.DRY_RUN, false),
  schedulerEnabled: bool(process.env.SCHEDULER_ENABLED, true),
  pollSec: num(process.env.POLL_SEC, 15),
  priorityMicroLamports: num(process.env.PRIORITY_MICRO_LAMPORTS, 100_000),
  adminKey: (process.env.ADMIN_KEY || "").trim(),
};

/// "bot" when the L1 key is present, "watch" otherwise (layers have their own keys)
export const mode = () => (config.l1Wallet ? "bot" : "watch");

if (config.split.selfBps + config.split.downBps + config.split.opsBps !== 10_000) throw new Error("SELF/DOWN/OPS_SHARE_BPS must add up to 10000");
if (!config.l1Mint) console.warn("[config] L1_MINT not set — the page runs in 'genesis pending' mode, nothing launches");
if (config.l1Mint && !config.l1Wallet) console.warn("[config] L1_WALLET_PRIVATE_KEY missing or invalid — $L1 runs in watch mode (dry settlements for $L1)");
if (!config.masterKey) console.warn("[config] MASTER_KEY not set — coin wallets will be stored UNENCRYPTED (dev only!)");
if (config.split.opsBps > 0 && !config.opsWallet) console.warn("[config] OPS_WALLET not set — the ops share waits in each coin wallet until it is");
if (!config.schedulerEnabled) console.warn("[config] SCHEDULER_ENABLED=false — kill switch ON: no claims, no buys, no burns");
if (config.dryRun) console.warn("[config] DRY_RUN=true — settlements are computed, nothing moves");
