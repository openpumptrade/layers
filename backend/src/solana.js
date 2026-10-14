import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import bs58 from "bs58";
import { config } from "./config.js";

export const connection = new Connection(config.rpcUrl, "confirmed");
export const LAMPORTS = LAMPORTS_PER_SOL;
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/// Builds, signs, simulates and sends a v0 transaction with priority fees. Returns the signature after 'confirmed'.
export async function sendTx({ instructions, payer, signers, computeUnits = 300_000, skipSimulation = false, lookupTables = [] }) {
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: config.priorityMicroLamports }),
    ...instructions,
  ];
  // a public RPC behind a load balancer can simulate on a node that has not seen the blockhash yet
  // ("BlockhashNotFound") — retry with a fresh one instead of failing the run
  for (let attempt = 1; ; attempt++) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(lookupTables);
    const tx = new VersionedTransaction(msg);
    tx.sign(signers);
    if (!skipSimulation) {
      const sim = await connection.simulateTransaction(tx, { commitment: "confirmed" });
      if (sim.value.err) {
        const err = JSON.stringify(sim.value.err);
        if (/BlockhashNotFound/i.test(err) && attempt < 4) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        const logs = (sim.value.logs || []).slice(-6).join("\n");
        throw new Error(`simulation failed: ${err}\n${logs}`);
      }
    }
    const sig = await connection.sendTransaction(tx, { skipPreflight: true, maxRetries: 5 });
    const conf = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    if (conf.value.err) {
      const t = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 }).catch(() => null);
      const logs = (t?.meta?.logMessages || []).filter((l) => /Error|failed/i.test(l)).slice(-3).join(" | ");
      throw new Error(`tx ${sig} failed on chain: ${JSON.stringify(conf.value.err)} ${logs}`);
    }
    return sig;
  }
}

/// Free simulation of unsigned instructions from any (funded) payer — no keys needed.
export async function simulate({ instructions, payer, computeUnits = 400_000 }) {
  const msg = new TransactionMessage({ payerKey: new PublicKey(payer), recentBlockhash: "11111111111111111111111111111111", instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }), ...instructions] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  const logs = sim.value.logs || [];
  const reason = logs.find((l) => /Error Message/.test(l))?.replace(/.*Error Message: /, "") || (sim.value.err ? JSON.stringify(sim.value.err) : "");
  return { ok: !sim.value.err, error: reason, units: sim.value.unitsConsumed, logs, bytes: tx.serialize().length };
}

export async function getSolBalance(pubkey) {
  return (await connection.getBalance(new PublicKey(pubkey))) / LAMPORTS_PER_SOL;
}

// ------------------------------------------------------------- USD prices
const priceCache = new Map(); // mint → {price, ts}
/// USD price of a mint Jupiter knows (SOL = WSOL), 30 s cache, CoinGecko fallback for SOL. Coins on the
/// tree are NOT priced here — their price is read through their quote chain (tracker.js).
export async function getUsdPrice(mint) {
  const key = String(mint);
  const hit = priceCache.get(key);
  if (hit && Date.now() - hit.ts < 30_000 && hit.price > 0) return hit.price;
  let price = 0;
  try {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${key}`, { signal: AbortSignal.timeout(8_000) });
    const json = await res.json();
    price = Number(json?.[key]?.usdPrice ?? json?.data?.[key]?.price);
  } catch { /* fall through */ }
  if (!(isFinite(price) && price > 0) && key === WSOL_MINT) {
    try {
      const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", { signal: AbortSignal.timeout(8_000) });
      price = Number((await res.json())?.solana?.usd);
    } catch { /* stale */ }
  }
  if (isFinite(price) && price > 0) priceCache.set(key, { price, ts: Date.now() });
  return priceCache.get(key)?.price || 0;
}
export const getSolUsd = () => getUsdPrice(WSOL_MINT);

// ------------------------------------------------------------- wallets
/// bs58 (Phantom/Solflare export) or a JSON byte array.
export function keypairFromSecret(raw) {
  const s = (raw || "").trim();
  if (s.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
  return Keypair.fromSecretKey(bs58.decode(s));
}
export function newWallet() {
  const kp = Keypair.generate();
  return { address: kp.publicKey.toBase58(), secret: bs58.encode(kp.secretKey) };
}
