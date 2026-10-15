#!/usr/bin/env node
/// Roll up a layer on a base coin from the CLI (what the site does, without the deposit flow):
///   node scripts/rollup.mjs --parent <mint> --name "My L2" --symbol MYL2 [--image logo.png] [--tax 100] [--dev-buy 0.2] [--key <bs58>] [--live]
/// DRY RUN by default: resolves the parent as a pump-coin quote (the SDK walks its chain), builds create_v2
/// with the pump-quote remaining accounts and simulates it for free. `--live` sends it signed by --key
/// (or L1_WALLET_PRIVATE_KEY); that wallet becomes the coin's creator and must then run its settlements.
import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { config } from "../src/config.js";
import { connection, sendTx, LAMPORTS, keypairFromSecret } from "../src/solana.js";
import { resolveQuote, buildCreate, simulateCreate, uploadIpfs, multiHopBuy, readChain, taxConfig, maxDepthAllowed, WSOL_MINT } from "../src/pumpfun.js";

const FUNDED_PUBLIC_PAYER = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
function args() { const a = process.argv.slice(2), o = {}; for (let i = 0; i < a.length; i++) { if (!a[i].startsWith("--")) continue; const k = a[i].slice(2); o[k] = a[i + 1] && !a[i + 1].startsWith("--") ? a[++i] : "true"; } return o; }

async function main() {
  const o = args();
  if (!o.parent) throw new Error("--parent <mint> is required");
  const live = o.live === "true";
  const name = o.name || "My L2", symbol = (o.symbol || "MYL2").toUpperCase();
  const wallet = o.key ? keypairFromSecret(o.key) : config.l1Wallet;
  if (live && !wallet) throw new Error("--live needs --key or L1_WALLET_PRIVATE_KEY");
  const payer = wallet ? wallet.publicKey : new PublicKey(FUNDED_PUBLIC_PAYER);

  const parentPk = new PublicKey(o.parent);
  const chain = await readChain(o.parent);
  const quote = await resolveQuote(parentPk);
  const allowed = await maxDepthAllowed();
  console.log(`\nparent ${o.parent} · chain SOL${chain.map((m) => ` → ${m.slice(0, 6)}…`).join("")} → parent · the new coin would be depth ${quote.depth} (allowed ≤ ${allowed})`);
  if (quote.depth > allowed) throw new Error(`too deep: pump.fun allows depth ≤ ${allowed} right now`);
  const gate = await taxConfig();
  const taxBps = o.tax ? Number(o.tax) : config.creatorTaxBps;
  if (!gate.enabled) console.log("note: pump.fun's tax gate is OFF — the coin launches without its own tax");
  else if (taxBps < 1 || taxBps > gate.maxBps) throw new Error(`--tax must be 1..${gate.maxBps} bps`);
  else console.log(`tax: ${taxBps / 100}% of every trade, paid in the parent coin → the creator`);
  const acc = quote.pumpQuote.accounts;
  console.log(`create_v2 remaining accounts: parent's curve${acc.pool ? " + pool + vaults" : ""} + ${(acc.chain || []).length} chain group(s)`);

  const mintKp = Keypair.generate();
  let uri = "https://pump.fun";
  if (live) {
    const img = o.image ? path.resolve(o.image) : "";
    if (!img || !fs.existsSync(img)) throw new Error("--image <png/jpg> is required to upload the metadata");
    uri = await uploadIpfs({ name, symbol, description: o.description || "", imageBuffer: fs.readFileSync(img), imageMime: /\.jpe?g$/i.test(img) ? "image/jpeg" : "image/png", twitter: o.twitter, telegram: o.telegram, website: o.website });
  }
  const sim = await simulateCreate({ mint: mintKp.publicKey, name, symbol, uri, payer, quote, taxBps: gate.enabled ? taxBps : 0 });
  console.log(`simulate create_v2 (pump-coin quote, depth ${quote.depth}): ${sim.ok ? "OK" : "FAILED"}${sim.error ? ` — ${sim.error}` : ""} · ${sim.units} CU · ${sim.bytes} bytes`);
  if (!sim.ok) { console.log(sim.logs.slice(-10).join("\n")); process.exit(1); }
  if (!live) { console.log(`\nDRY RUN — nothing sent. Mint would be ${mintKp.publicKey.toBase58()}. Add --live (and --image) to launch for real.`); return; }

  const ix = await buildCreate({ mint: mintKp.publicKey, name, symbol, uri, creator: wallet.publicKey, user: wallet.publicKey, quote, taxBps: gate.enabled ? taxBps : 0 });
  const sig = await sendTx({ instructions: [ix], payer: wallet.publicKey, signers: [wallet, mintKp], computeUnits: 400_000 });
  const mint = mintKp.publicKey.toBase58();
  console.log(`\n✅ GREW $${symbol} on the tree · CA ${mint} · depth ${quote.depth} · tx ${sig}\n   https://pump.fun/coin/${mint}`);
  const devBuy = Number(o["dev-buy"] || 0);
  if (devBuy > 0) {
    const { sig: b, hops } = await multiHopBuy({ wallet, path: [WSOL_MINT, ...chain, o.parent, mint], lamports: BigInt(Math.floor(devBuy * LAMPORTS)) });
    console.log(`   dev buy ${devBuy} SOL → $${symbol} through ${hops} hops · ${b}`);
  }
  console.log(`\nThe coin is NOT in the launchpad's registry (launched from the CLI). Its creator wallet holds the fees; the site only runs the coins it launched.`);
}
main().catch((e) => { console.error("✖", e.message); process.exit(1); });
