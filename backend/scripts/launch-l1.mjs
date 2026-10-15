#!/usr/bin/env node
/// Deploy $L1 on pump.fun: a standard coin paired with SOL (depth 0) — the creator wallet becomes the L1 wallet.
///
///   node scripts/launch-l1.mjs --name L1 --symbol L1 --image public/icon.png \
///     --description "stack coins on coins — launch a layer on a memecoin" \
///     [--website https://…] [--twitter https://x.com/…] [--telegram https://t.me/…] [--dev-buy 0.5] [--grind pump] [--live]
///
/// DRY RUN by default: builds create_v2 and simulates it (no keys needed). `--live` uploads the metadata
/// to IPFS and sends the transactions with L1_WALLET_PRIVATE_KEY from .env; that wallet = the L1 wallet.
/// Launching from the pump.fun site with the L1 wallet as creator works just as well (SOL pair,
/// Creator Fee coin — NOT Holder Rewards: the engine needs to claim the fees).
import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { config } from "../src/config.js";
import { connection, sendTx, LAMPORTS } from "../src/solana.js";
import { SOL_QUOTE, buildCreate, simulateCreate, uploadIpfs, curveBuy, mintProgramId } from "../src/pumpfun.js";

const FUNDED_PUBLIC_PAYER = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"; // any funded wallet works for a sigVerify-off simulation

function args() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) { if (!a[i].startsWith("--")) continue; const k = a[i].slice(2); o[k] = a[i + 1] && !a[i + 1].startsWith("--") ? a[++i] : "true"; }
  return o;
}
function grind(suffix) {
  const t0 = Date.now(); let n = 0;
  for (;;) { const kp = Keypair.generate(); n++; if (kp.publicKey.toBase58().endsWith(suffix)) { console.log(`   ground ${kp.publicKey.toBase58()} in ${n.toLocaleString()} tries (${((Date.now() - t0) / 1000).toFixed(0)}s)`); return kp; } if (n % 200_000 === 0) console.log(`   …${n.toLocaleString()} tries`); }
}

async function main() {
  const o = args();
  const live = o.live === "true";
  const name = o.name || "L1", symbol = o.symbol || "L1";
  if (symbol.length > 13) throw new Error("symbol max 13 chars");
  const wallet = config.l1Wallet;
  if (live && !wallet) throw new Error("--live needs L1_WALLET_PRIVATE_KEY in backend/.env (that wallet becomes the creator = the L1 wallet)");
  const payer = wallet ? wallet.publicKey : new PublicKey(FUNDED_PUBLIC_PAYER);
  console.log(`\n$${symbol} · "${name}" · paired with SOL (depth 0 — the base layer)\ncreator / L1 wallet: ${payer.toBase58()}${wallet ? "" : " (public stand-in, dry run)"}`);
  const mintKp = o.grind ? (console.log(`grinding a mint ending in "${o.grind}"…`), grind(o.grind)) : Keypair.generate();
  const mint = mintKp.publicKey;
  let uri = "https://pump.fun";
  if (live || o.upload === "true") {
    const img = o.image ? path.resolve(o.image) : "";
    if (!img || !fs.existsSync(img)) throw new Error("--image <png/jpg> is required to upload the metadata");
    uri = await uploadIpfs({ name, symbol, description: o.description || "", imageBuffer: fs.readFileSync(img), imageMime: /\.jpe?g$/i.test(img) ? "image/jpeg" : "image/png", twitter: o.twitter, telegram: o.telegram, website: o.website });
    console.log(`metadata: ${uri}`);
  }
  const sim = await simulateCreate({ mint, name, symbol, uri, payer, quote: SOL_QUOTE });
  console.log(`simulate create_v2: ${sim.ok ? "OK" : "FAILED"}${sim.error ? ` — ${sim.error}` : ""} · ${sim.units} CU · ${sim.bytes} bytes`);
  if (!sim.ok) { console.log(sim.logs.slice(-8).join("\n")); process.exit(1); }
  const devBuy = Number(o["dev-buy"] || 0);
  if (!live) { console.log(`\nDRY RUN — nothing sent. Mint would be ${mint.toBase58()}. Add --live (and --image) to deploy for real.`); return; }
  const sol = (await connection.getBalance(wallet.publicKey)) / LAMPORTS;
  if (sol < 0.03 + devBuy) throw new Error(`fund the wallet first (≥ ${(0.03 + devBuy).toFixed(3)} SOL)`);
  const createIx = await buildCreate({ mint, name, symbol, uri, creator: wallet.publicKey, user: wallet.publicKey, quote: SOL_QUOTE });
  const sig = await sendTx({ instructions: [createIx], payer: wallet.publicKey, signers: [wallet, mintKp], computeUnits: 300_000 });
  console.log(`\n✅ PLANTED $${symbol} · CA ${mint.toBase58()} · tx ${sig}\n   https://pump.fun/coin/${mint.toBase58()}`);
  if (devBuy > 0) {
    const programId = await mintProgramId(mint.toBase58());
    const { sig: b } = await curveBuy({ wallet, mint: mint.toBase58(), quote: SOL_QUOTE, quoteAmountRaw: BigInt(Math.floor(devBuy * LAMPORTS)), programId });
    console.log(`   dev buy ${devBuy} SOL · ${b}`);
  }
  console.log(`\nNow set in backend/.env (and Railway):\n   L1_MINT=${mint.toBase58()}\nThe L1 wallet is this wallet — its key claims the SOL fees, buys $L1 back and burns it every settlement.`);
}
main().catch((e) => { console.error("✖", e.message); process.exit(1); });
