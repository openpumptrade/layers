import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { PublicKey } from "@solana/web3.js";
import { config, mode } from "./config.js";
import { sql } from "./db.js";
import { encryptSecret } from "./crypto.js";
import { connection, newWallet } from "./solana.js";
import { estimateCurveBuy, fetchTrades, toRaw, taxConfig } from "./pumpfun.js";
import { coins, liveCoins, l1Coin, childrenOf, stackStats, quoteOf, LEVELS, LEVEL_NAMES, LEVELS_COINS } from "./stack.js";
import { market, fuelOf } from "./tracker.js";
import { state as settlement, rowToJson } from "./settlement.js";
import { adminRefund, auditLaunches, deliverToUser, resolveParent } from "./launcher.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, "..", "public");
const now = () => Math.floor(Date.now() / 1000);
const round9 = (n) => Math.round(n * 1e9) / 1e9;
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v;
  const v = await fn(); cache.set(key, { v, at: Date.now() }); return v;
}
const validPk = (s) => { try { return Boolean(new PublicKey(s)); } catch { return false; } };

function coinJson(c, full = false) {
  const q = quoteOf(c);
  const base = {
    mint: c.mint, isL1: c.isL1, launchId: c.launchId, name: c.name, symbol: c.symbol, image: c.image, description: c.description,
    twitter: c.twitter, telegram: c.telegram, website: c.website,
    parent: c.parent, depth: c.depth, chain: c.chain, children: childrenOf(c.mint).length,
    quote: { mint: q.mint, symbol: q.symbol, decimals: q.decimals, isSol: q.isSol, priceUsd: c.isL1 ? market.solUsd : coins.get(c.parent)?.priceUsd || 0 },
    launchedAt: c.launchedAt, launchTx: c.launchTx, devBuySol: c.devBuySol, taxBps: c.taxBps || c.creatorTaxBps, userWallet: c.userWallet, wallet: c.wallet,
    tokenProgram: c.tokenProgram, createdTs: c.createdTs, pool: c.pool, graduated: c.graduated,
    priceQuote: c.priceQuote, priceUsd: c.priceUsd, mcapUsd: c.mcapUsd, realMcapUsd: c.priceUsd * c.supply,
    supply0: c.supply0, supply: c.supply, burned: c.burned, burnedPct: c.supply0 ? c.burned / c.supply0 : 0,
    holders: c.holders || 0, volume24hUsd: c.volume24hUsd || 0, marketUpdatedAt: c.priceUpdatedAt,
    pot: { ...c.pot, fuel: fuelOf(c), fuelUsd: fuelOf(c) * (c.isL1 ? market.solUsd : coins.get(c.parent)?.priceUsd || 0), opsOwedQuote: c.opsOwedQuote || 0, bucket: c.creatorBucket || 0 },
    cyclesRun: c.cyclesRun, totalClaimedQuote: c.totalClaimedQuote, totalSelfQuote: c.totalSelfQuote, totalSelfBurned: c.totalSelfBurned, totalDownQuote: c.totalDownQuote, totalOpsQuote: c.totalOpsQuote, totalFeesUsd: c.totalFeesUsd,
    lastCycleAt: c.lastCycleAt, lastNote: c.lastNote, progress: c.progressState,
  };
  if (!full) return base;
  return { ...base, chainCoins: c.chain.map((m) => { const p = coins.get(m); return p ? { mint: m, symbol: p.symbol, image: p.image, depth: p.depth } : { mint: m, symbol: m.slice(0, 4), image: "", depth: 0 }; }), links: { pump: `https://pump.fun/coin/${c.mint}`, explorer: `https://solscan.io/token/${c.mint}`, wallet: `https://solscan.io/account/${c.wallet}`, tx: "https://solscan.io/tx/" } };
}

export function startApi(started) {
  const app = express();
  app.use(cors());
  app.set("etag", false);
  app.use(express.json({ limit: "5mb" }));
  app.use("/api", (_req, res, next) => { res.set("cache-control", "no-store"); next(); });

  const common = () => {
    const l1 = l1Coin();
    return {
      started, brand: config.brand, rules: { ...config.rules, split: config.split, taxBps: config.creatorTaxBps, intervalSec: config.rules.intervalSec }, chain: "Solana", launchpad: "pump.fun",
      mode: mode(), dryRun: config.dryRun, schedulerEnabled: config.schedulerEnabled,
      solUsd: market.solUsd, maxCurveDepth: market.maxCurveDepth, maxDepth: market.maxDepthAllowed, taxGate: market.taxGate,
      settlement: { nextAt: settlement.nextCycleAt, genesis: settlement.genesis, cycle: settlement.cycle, firing: settlement.firing, lastRunAt: settlement.lastRunAt, last: settlement.lastSummary },
      l1: l1 ? coinJson(l1) : null, announced: config.l1MintAnnounced,
      stack: stackStats(), levels: LEVELS, levelsCoins: LEVELS_COINS, levelNames: LEVEL_NAMES,
      launch: { gasSol: config.launchGasSol, maxDevBuySol: config.maxDevBuySol, timeoutMin: config.depositTimeoutMin, taxBps: config.creatorTaxBps },
      now: now(),
    };
  };

  app.get("/api/health", (_req, res) => res.json({ ok: true, started, coins: coins.size, cycle: settlement.cycle, nextCycleAt: settlement.nextCycleAt, scheduler: config.schedulerEnabled, dryRun: config.dryRun, mode: mode(), maxDepth: market.maxDepthAllowed }));

  /// the whole stack: every live coin with its place — what the scene draws
  app.get("/api/stack", async (_req, res) => {
    const list = liveCoins().sort((a, b) => a.depth - b.depth || a.launchedAt - b.launchedAt).map((c) => coinJson(c));
    const [agg] = started ? await sql`select count(*)::int as n, coalesce(sum((self_quote + down_quote + ops_quote) * coalesce(quote_usd, 0)), 0) as sap_usd, coalesce(sum(self_burned), 0) as self_burned from runs where status = 'done' and dry = false` : [{ n: 0, sap_usd: 0, self_burned: 0 }];
    const [pend] = started ? await sql`select count(*)::int as n from coins where status in ('awaiting_deposit', 'launching')` : [{ n: 0 }];
    res.json({ ...common(), coins: list, totals: { runs: agg.n, feesUsd: Number(agg.sap_usd), selfBurned: Number(agg.self_burned), pendingLaunches: pend.n } });
  });

  app.get("/api/coins", (req, res) => {
    const sort = String(req.query.sort || "new");
    let list = liveCoins().filter((c) => !c.isL1).map((c) => coinJson(c));
    const key = { new: (c) => c.launchedAt, mcap: (c) => c.mcapUsd || 0, burned: (c) => c.burnedPct, depth: (c) => c.depth, fees: (c) => c.totalFeesUsd, fuel: (c) => c.pot.fuelUsd, children: (c) => c.children }[sort] || ((c) => c.launchedAt);
    list.sort((a, b) => key(b) - key(a));
    const q = String(req.query.q || "").trim().toLowerCase();
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q) || c.mint.toLowerCase().includes(q));
    const parent = String(req.query.parent || "");
    if (parent) list = list.filter((c) => c.parent === parent);
    res.json({ ...common(), coins: list.slice(0, 300) });
  });

  /// global ledger of the latest settlements across the stack
  app.get("/api/runs", async (req, res) => {
    const limit = Math.min(200, Number(req.query.limit || 40));
    const mint = String(req.query.mint || "");
    const rows = mint
      ? await sql`select * from runs where mint = ${mint} and status in ('done', 'skipped', 'failed') order by id desc limit ${limit}`
      : await sql`select * from runs where status = 'done' order by id desc limit ${limit}`;
    res.json(rows.map((r) => ({ ...rowToJson(r), symbol: coins.get(r.mint)?.symbol || "", image: coins.get(r.mint)?.image || "", isL1: Boolean(coins.get(r.mint)?.isL1), quoteSymbol: coins.get(r.mint) ? quoteOf(coins.get(r.mint)).symbol : "", depth: coins.get(r.mint)?.depth ?? 0 })));
  });

  // ------------------------------------------------------------ per coin
  const coinOr404 = (req, res) => { const c = coins.get(String(req.params.mint)); if (!c || c.status !== "live") res.status(404).json({ error: "unknown coin" }); return c && c.status === "live" ? c : null; };

  app.get("/api/coin/:mint", async (req, res) => {
    const c = coinOr404(req, res); if (!c) return;
    const out = { ...common(), ...coinJson(c, true), childrenList: childrenOf(c.mint).map((k) => coinJson(k)) };
    const q = quoteOf(c);
    const fuel = fuelOf(c) * (c.isL1 ? 1 : config.split.selfBps / 10_000);
    try { out.pot.estTokens = fuel > 0 ? (c.graduated ? fuel / (c.priceQuote || 1) : (await estimateCurveBuy(c.mint, toRaw(fuel, q.decimals))) ?? 0) : 0; } catch { out.pot.estTokens = 0; }
    res.json(out);
  });

  app.get("/api/coin/:mint/runs", async (req, res) => {
    const c = coinOr404(req, res); if (!c) return;
    const rows = await sql`select * from runs where mint = ${c.mint} and status in ('done', 'skipped', 'failed') order by id desc limit ${Math.min(300, Number(req.query.limit || 100))}`;
    res.json(rows.map(rowToJson));
  });

  /// price history from our own samples (nested coins are on no candle API) with run markers
  app.get("/api/coin/:mint/chart", async (req, res) => {
    const c = coinOr404(req, res); if (!c) return;
    const since = now() - (String(req.query.r || "24h") === "7d" ? 7 * 86400 : 86400);
    const rows = await sql`select ts, price_usd, mcap_usd from samples where mint = ${c.mint} and ts > ${since} order by ts`;
    const runs = (await sql`select id, ts, dry, self_burned, down_quote from runs where mint = ${c.mint} and status = 'done' and ts > ${since} order by id`).map((r) => ({ id: r.id, t: r.ts, dry: r.dry, selfBurned: r.self_burned, downQuote: r.down_quote }));
    res.json({ source: "samples", points: rows.map((r) => ({ t: r.ts, c: r.price_usd, m: r.mcap_usd })), runs, priceUsd: c.priceUsd, mcapUsd: c.mcapUsd, now: now() });
  });

  app.get("/api/coin/:mint/trades", async (req, res) => {
    const c = coinOr404(req, res); if (!c) return;
    try {
      const trades = await cached(`trades:${c.mint}`, 6_000, () => fetchTrades(c.mint, 40));
      res.json(trades.map((t) => ({
        t: Math.floor(new Date(t.timestamp ?? 0).getTime() / 1000) || Math.floor(Number(t.timestamp ?? 0) / 1000),
        side: /buy/i.test(String(t.type ?? t.side ?? "")) || t.is_buy === true ? "buy" : "sell",
        quote: Number(t.amountSol ?? t.quoteAmount ?? 0), tokens: Number(t.baseAmount ?? t.token_amount ?? 0), usd: Number(t.amountUsd ?? 0),
        wallet: String(t.userAddress ?? t.user ?? ""), tx: String(t.tx ?? t.signature ?? ""), engine: String(t.userAddress ?? "") === c.wallet,
      })).filter((t) => t.t > 0));
    } catch { res.json([]); }
  });

  // ---------------------------------------------------------------- launch (roll up)
  /// what the launch form needs: the layers one can launch on right now, the depth gate, the tax
  app.get("/api/launch/options", async (_req, res) => {
    const maxDepth = market.maxDepthAllowed;
    const parents = liveCoins().filter((c) => c.depth < maxDepth).sort((a, b) => a.depth - b.depth || b.mcapUsd - a.mcapUsd).map((c) => ({ mint: c.mint, symbol: c.symbol, name: c.name, image: c.image, depth: c.depth, mcapUsd: c.mcapUsd, children: childrenOf(c.mint).length, isL1: c.isL1, graduated: c.graduated }));
    const gate = await cached("tax-gate", 60_000, () => taxConfig()).catch(() => null);
    res.json({ ...common(), parents, maxDepth, taxBps: config.creatorTaxBps, taxGate: gate });
  });

  /// pre-flight: can this parent take a child right now? (walks the chain through the SDK, no keys)
  app.get("/api/launch/check/:mint", async (req, res) => {
    try { const { parent, quote } = await resolveParent(String(req.params.mint)); res.json({ ok: true, parent: parent.symbol, depth: quote.depth, chainLength: (quote.pumpQuote?.accounts?.chain || []).length + 1, migratedQuote: Boolean(quote.pumpQuote?.accounts?.pool) }); }
    catch (err) { res.json({ ok: false, error: String(err.message).slice(0, 240) }); }
  });

  app.post("/api/launch", async (req, res) => {
    try {
      if (!started) return res.status(400).json({ error: "$L1 has no genesis yet" });
      const b = req.body || {};
      const name = String(b.name || "").trim();
      const symbol = String(b.symbol || "").trim().toUpperCase();
      const devBuySol = Number(b.devBuySol || 0);
      const userWallet = String(b.userWallet || "").trim();
      const parentMint = String(b.parent || "").trim();
      if (!name || name.length > 32) return res.status(400).json({ error: "bad name (1–32 chars)" });
      if (!symbol || Buffer.byteLength(symbol) > config.symbolMax || !/^[A-Z0-9]+$/.test(symbol)) return res.status(400).json({ error: `bad ticker (A–Z, 0–9, max ${config.symbolMax})` });
      if (!isFinite(devBuySol) || devBuySol < 0 || devBuySol > config.maxDevBuySol) return res.status(400).json({ error: `dev buy must be 0–${config.maxDevBuySol} SOL` });
      if (!validPk(userWallet)) return res.status(400).json({ error: "connect a Solana wallet first" });
      const imageId = String(b.imageId || "");
      if (!imageId || !(await sql`select 1 from uploads where id = ${imageId}`).length) return res.status(400).json({ error: "every coin needs a logo" });
      const { parent, quote } = await resolveParent(parentMint);
      const { address, secret } = newWallet();
      const launchId = crypto.randomUUID();
      const expected = round9(devBuySol + config.launchGasSol);
      const website = `${config.brand.siteUrl}/l/${launchId}`;
      const image = `${config.publicApiUrl}/api/uploads/${imageId}`;
      await sql`insert into coins (launch_id, status, wallet, wallet_secret_enc, user_wallet, name, symbol, description, image_upload_id, image, website, twitter, telegram, parent_mint, depth, chain, quote_mint, quote_decimals, quote_token_program, dev_buy_sol, deposit_expected_sol, creator_tax_bps)
        values (${launchId}, 'awaiting_deposit', ${address}, ${encryptSecret(secret)}, ${userWallet}, ${name}, ${symbol}, ${String(b.description || "").slice(0, 500)}, ${imageId}, ${image}, ${website},
          ${String(b.twitter || "").trim().slice(0, 200)}, ${String(b.telegram || "").trim().slice(0, 200)}, ${parent.mint}, ${quote.depth}, ${JSON.stringify([...parent.chain, parent.mint])}, ${parent.mint}, ${quote.decimals}, ${quote.tokenProgram.toBase58()}, ${devBuySol}, ${expected}, ${config.creatorTaxBps})`;
      res.json({ launchId, depositAddress: address, expectedSol: expected, gasSol: config.launchGasSol, devBuySol, timeoutMin: config.depositTimeoutMin, taxBps: config.creatorTaxBps, parent: parent.symbol, depth: quote.depth });
    } catch (err) {
      console.error("[api] launch:", err.message);
      res.status(400).json({ error: String(err.message).slice(0, 240) });
    }
  });

  app.get("/api/launch/:id", async (req, res) => {
    const [row] = await sql`select launch_id, status, mint, error, wallet, deposit_expected_sol, refund_tx, symbol, parent_mint, depth from coins where launch_id = ${req.params.id}`;
    if (!row) return res.status(404).json({ error: "not found" });
    res.json({ launchId: row.launch_id, status: row.status, mint: row.mint, error: row.error, depositAddress: row.wallet, expectedSol: Number(row.deposit_expected_sol), refundTx: row.refund_tx, symbol: row.symbol, parent: row.parent_mint, depth: row.depth });
  });

  /// SOL balance of a wallet — the page checks it before asking the wallet to sign a transfer that cannot land
  app.get("/api/balance/:pk", async (req, res) => {
    if (!validPk(req.params.pk)) return res.status(400).json({ error: "bad address" });
    try { res.json({ sol: (await connection.getBalance(new PublicKey(req.params.pk))) / 1e9 }); } catch (err) { res.status(500).json({ error: err.message }); }
  });
  /// a fresh blockhash for the page to build the deposit transfer (keeps the RPC key server-side)
  app.get("/api/blockhash", async (_req, res) => {
    try { const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed"); res.json({ blockhash, lastValidBlockHeight }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/upload", async (req, res) => {
    const { data, mime } = req.body || {};
    if (!data || !mime || !/^image\//.test(mime)) return res.status(400).json({ error: "bad upload" });
    if (data.length > 4 * 1024 * 1024) return res.status(400).json({ error: "max 3MB" });
    const id = crypto.randomBytes(8).toString("hex");
    await sql`insert into uploads (id, mime, data) values (${id}, ${mime}, ${data})`;
    res.json({ id, url: `${config.publicApiUrl}/api/uploads/${id}` });
  });
  app.get("/api/uploads/:id", async (req, res) => {
    const rows = await sql`select mime, data from uploads where id = ${req.params.id}`;
    if (!rows.length) return res.status(404).end();
    res.set("Content-Type", rows[0].mime);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.send(Buffer.from(rows[0].data, "base64"));
  });

  // ---------------------------------------------------------------- admin
  const admin = (req, res) => { if (config.adminKey && req.get("x-admin-key") === config.adminKey) return true; res.status(401).json({ error: "nope" }); return false; };
  app.get("/api/admin/launches", async (req, res) => { if (!admin(req, res)) return; try { res.json(await auditLaunches()); } catch (err) { res.status(500).json({ error: String(err.message).slice(0, 300) }); } });
  app.post("/api/admin/refund/:launchId", async (req, res) => { if (!admin(req, res)) return; try { res.json(await adminRefund(String(req.params.launchId))); } catch (err) { res.status(500).json({ error: String(err.message).slice(0, 300) }); } });
  app.post("/api/admin/deliver/:mint", async (req, res) => { if (!admin(req, res)) return; try { res.json(await deliverToUser(String(req.params.mint))); } catch (err) { res.status(500).json({ error: String(err.message).slice(0, 300) }); } });

  // ---------------------------------------------------------------- pages
  app.get("/l/:id", async (req, res) => {
    const [row] = await sql`select mint from coins where launch_id = ${req.params.id}`;
    res.redirect(302, row?.mint ? `/c/${row.mint}` : "/");
  });
  app.get(["/c/:mint", "/launch", "/coins", "/settlement", "/docs"], (_req, res) => res.sendFile(path.join(pub, "index.html")));
  app.use(express.static(pub, { etag: false, maxAge: 0 }));
  app.listen(config.port, () => console.log(`[api] listening on :${config.port}`));
}
