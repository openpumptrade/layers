#!/usr/bin/env node
/// Read a coin's place in the tree straight from the chain, no keys:
///   node scripts/chain.mjs <mint>
/// Prints its quote chain down to SOL, its depth, the pump.fun depth gate, whether a child can be grown on
/// it right now (resolveQuoteMint walks the chain as create_v2 would) and the remaining accounts a create
/// would pass (Q's curve/pool + one group per coin below Q).
import { PublicKey } from "@solana/web3.js";
import { loadCurve, readChain, resolveQuote, pumpGlobals, maxDepthAllowed, curvePriceInQuote, poolPriceInQuote, SOL_QUOTE, PROGRAM_MAX_DEPTH } from "../src/pumpfun.js";

const mint = process.argv[2];
if (!mint) { console.error("usage: node scripts/chain.mjs <mint>"); process.exit(1); }

const g = await pumpGlobals();
console.log(`pump.fun Global.max_curve_depth = ${g.maxCurveDepth} (program cap ${PROGRAM_MAX_DEPTH}) · this tree allows depth ≤ ${await maxDepthAllowed()}\n`);
const curve = await loadCurve(mint);
const chain = await readChain(mint);
console.log(`${mint}\n  depth ${curve.depth} · quote ${curve.quoteIsSol ? "SOL" : curve.quoteMintPk.toBase58()} · tax ${curve.taxBps / 100}% · ${curve.complete ? "graduated" : "on the curve"} · creator ${curve.creator}`);
console.log(`  chain: SOL${chain.map((m) => ` → ${m}`).join("")} → ${mint}`);
const quoteDecimals = curve.quoteIsSol ? 9 : 6;
const price = curve.complete ? (await poolPriceInQuote(mint, curve.quoteIsSol ? SOL_QUOTE : { mint: curve.quoteMintPk.toBase58(), isSol: false, decimals: 6 })).price : curvePriceInQuote(curve, quoteDecimals);
console.log(`  price: ${price} ${curve.quoteIsSol ? "SOL" : "of its quote"} per token · v3 creator bucket ${Number(curve.creatorBucketRaw) / 10 ** quoteDecimals}`);
try {
  const q = await resolveQuote(new PublicKey(mint));
  const acc = q.pumpQuote?.accounts || {};
  console.log(`\n  as a QUOTE for a new coin: ${q.source} → the child would be depth ${q.depth}`);
  console.log(`  create_v2 remaining accounts: Q's curve${acc.pool ? " + pool + 2 vaults" : ""}${(acc.chain || []).map((c, i) => `, chain[${i}] ${c.mint.toBase58().slice(0, 6)}… curve${c.pool ? " + pool + 2 vaults" : ""}`).join("")}`);
  console.log(`  child's initial virtual quote reserves: ${q.initialVirtualQuoteReserves} (raw)`);
} catch (err) { console.log(`\n  cannot be a quote right now: ${err.name || ""} ${err.message}`); }
process.exit(0);
