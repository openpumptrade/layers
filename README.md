# ROOT — a launchpad where every coin grows on another coin

pump.fun now lets a coin be **paired with another pump.fun coin** instead of SOL: a coin paired with SOL is
depth 0, a coin paired with a depth-0 coin is depth 1 (enabled last week), and since **October 13** a coin can
be paired with a depth-1 coin (depth 2). Same trading, same quotes; only `create_v2` takes more accounts.
ROOT is built on exactly that.

**The tree.** `$ROOT` is the trunk: a standard pump.fun coin paired with SOL. Anyone can **grow** a coin on
the tree: pick a parent (`$ROOT`, or any coin already on it, as deep as pump.fun's `Global.max_curve_depth`
allows), name it, drop a logo, send SOL. The coin is created with `create_v2` **quoted in the parent coin**
(the SDK walks the parent's chain down to `$ROOT` and passes one account group per coin) and born with a
**tax** (`CREATOR_TAX_BPS`, 1%) paid in the coin it grows on. Its creator is its own engine wallet.

A coin high on the tree is bought *through* every coin below it — buying a twig from SOL is one
`multi_hop_swap`: SOL → `$ROOT` → branch → twig. Every buy up the tree is a buy of every coin under it.

**The sap run.** One clock, every `CYCLE_INTERVAL_SEC` (10 min), per coin:

1. sweep the v3 fee bucket + claim **100%** of the creator fees (SOL for the trunk, the parent coin otherwise)
2. `SELF_SHARE_BPS` (50%) → one buy of the coin itself on its curve / pool → every token it brought in is **burned**
3. `DOWN_SHARE_BPS` (50%) → the **parent coin is burned** on the spot: sap flows down. `$ROOT` has no parent,
   so for the trunk this half buys `$ROOT` back and burns it too
4. `OPS_SHARE_BPS` (0%) → ops wallet, optional

Nothing is ever sold. Everything grown on a coin ends up burning the coins beneath it, down to the trunk.

## Layout

- `backend/src`
  - `pumpfun.js` — `@pump-fun/pump-sdk` 4.1 (CJS): `resolveQuote` (SOL / listed / **pump coin** via
    `resolveQuoteMint` + `fetchPumpQuote`), `buildCreate` with `pumpQuote` accounts, `readChain`, sweep +
    collect (v2 for token quotes), `buy_exact_quote_in_v3` curve buys, PumpSwap buys, `multiHopBuy` /
    `multiHopSellToSol`, burns, prices from curve / pool reserves.
  - `tree.js` — the registry: every live coin, its parent / depth / chain, levels ("rings"); registers `$ROOT`.
  - `tracker.js` — prices read **through the chain** (price in quote × quote's USD, trunk first), pots, samples.
  - `launcher.js` — grow: deposit → metadata → `create_v2` quoted in the parent → multi-hop dev buy → tokens to the user.
  - `sap.js` — the run: claim → self buy + burn → parent burn → ops; gas refills by selling a slice down the chain.
  - `api.js` — `/api/tree`, `/api/coins`, `/api/coin/:mint(/runs|/chart|/trades)`, `/api/runs`,
    `/api/grow/options`, `/api/grow/check/:mint`, `POST /api/grow`, `/api/grow/:id`, uploads, admin.
  - `db.js` (schema + advisory lock), `config.js`, `crypto.js` (AES-256-GCM wallet secrets), `solana.js`.
- `backend/scripts` — `launch-root.mjs` (plant `$ROOT`, dry run by default), `grow.mjs` (grow a coin on a
  parent from the CLI — simulates `create_v2` with the pump-quote accounts for free), `chain.mjs <mint>` (a
  coin's chain, depth, the depth gate, what a child would get).
- `backend/public` — the page: `index.html` (TREE · GROW · COINS · coin page · SAP · DOCS), `sprite.js`
  (palette, sprites, icons), `scene.js` (the grove: the trunk, a limb per coin, logos as fruit, sap drops,
  birds, fireflies), `brand.html` → `icon.png`, `og.png`, `root.gif`.

## Run

```bash
cd backend && cp .env.example .env     # MASTER_KEY, ROOT_MINT, ROOT_WALLET_PRIVATE_KEY, RPC_URL
createdb root
npm install && npm run dev             # http://localhost:4000
```

Without `ROOT_MINT` the page runs in "not planted yet" mode. Without the trunk's key `$ROOT` runs dry; grown
coins always run (their keys are in the table, encrypted). `SCHEDULER_ENABLED=false` is the kill switch.
`DRY_RUN=true` computes every run without moving anything.

```bash
node scripts/launch-root.mjs --name ROOT --symbol ROOT --image public/icon.png --live   # plant the trunk
node scripts/chain.mjs <mint>                                                             # inspect a coin's chain
node scripts/grow.mjs --parent <mint> --name Twig --symbol TWIG                          # dry-run a depth-N create
```

## Hosting

Railway builds `root/` (set the service root directory, `Dockerfile` here) with a Postgres plugin.
Vercel serves `backend/public`; `vercel.json` proxies `/api/*` and `/l/*` to Railway and rewrites `/c/*`
to the page. Set `SITE_URL` / `PUBLIC_API_URL` accordingly.

## Notes

- Dev buys route from SOL with `multi_hop_swap`; three hops fit a legacy transaction, so depth ≤ 2 is covered.
  Deeper (if pump.fun raises the gate) needs a lookup table — the launcher skips the dev buy and keeps the SOL
  as the coin wallet's gas reserve, and says so.
- A parent whose chain has a coin with a complete curve but no pool yet is refused by pump.fun
  (`QuoteCurveAwaitingMigration`); the grow form checks the chain before taking a deposit.
- Nested coins are on no candle API: prices come from the chain, charts from the engine's own samples.

## Deploy, step by step

**Railway (the engine + API)**
1. New project → Deploy from GitHub repo → this repo. Add the **Postgres** plugin (it sets `DATABASE_URL`).
2. Service → Settings → *Root Directory* = `root` (the `Dockerfile` and `railway.toml` are there).
3. Variables: `ROOT_MINT`, `ROOT_WALLET_PRIVATE_KEY`, `MASTER_KEY` (`openssl rand -hex 32`), `RPC_URL` (an
   indexed RPC — Helius / Chainstack), `SITE_URL` (the Vercel URL), `PUBLIC_API_URL` (the Railway URL),
   `BRAND_TWITTER`, `ADMIN_KEY`. Leave `ROOT_MINT` empty until `$ROOT` is planted.
4. Fund the trunk wallet with ~0.05 SOL of gas. `/api/health` must answer `ok: true`.

**Vercel (the page)**
1. New project → same repo → *Root Directory* = `root/backend/public`, framework "Other", no build command.
2. Edit `backend/public/vercel.json`: replace `REPLACE-WITH-RAILWAY-URL` with the Railway service URL.
3. Deploy. The page calls `/api/*` on its own origin; Vercel proxies it to Railway.
