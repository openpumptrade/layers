# LAYERS — launch your L2 on a memecoin

pump.fun lets a coin be **paired with another pump.fun coin** instead of SOL, and since **October 13** that
quote can itself be a coin paired with a coin: a coin paired with SOL is depth 0, a coin paired with a depth-0
coin is depth 1, a coin paired with a depth-1 coin is depth 2. Same trading, same quotes; only `create_v2`
takes more accounts. LAYERS is built on exactly that, and calls things by their crypto names: the depth-0 coin
is the **L1**, a coin on it is an **L2**, a coin on an L2 is an **L3**.

**The stack.** `$L1` is the base layer: a standard pump.fun coin paired with SOL. Anyone can **launch** a
layer on the stack: pick a base layer (`$L1`, or any coin already on it, as high as pump.fun's
`Global.max_curve_depth` allows), name it, drop a logo, send SOL. The coin is created with `create_v2`
**quoted in the base layer** (the SDK walks its chain down to `$L1` and passes one account group per coin)
and born with a **fee** (`CREATOR_TAX_BPS`, 1%) paid in the layer it runs on. Its creator is its own
sequencer wallet.

A coin high on the stack is bought *through* every layer below it — buying an L3 from SOL is one
`multi_hop_swap`: SOL → `$L1` → L2 → L3. Every buy up the stack is a buy of every layer under it.

**The settlement.** One clock, every `CYCLE_INTERVAL_SEC` (10 min), per coin:

1. sweep the v3 fee bucket + claim **100%** of the creator fees (SOL for `$L1`, the layer below otherwise)
2. `SELF_SHARE_BPS` (50%) → one buy of the coin itself on its curve / pool → every token it brought in is **burned**
3. `DOWN_SHARE_BPS` (50%) → the **layer below is burned** on the spot: fees settle down. `$L1` has nothing
   below it, so for `$L1` this half buys `$L1` back and burns it too
4. `OPS_SHARE_BPS` (0%) → ops wallet, optional

Nothing is ever sold. Everything launched on a layer ends up burning the layers beneath it, down to `$L1`.

## Layout

- `backend/src`
  - `pumpfun.js` — `@pump-fun/pump-sdk` 4.1 (CJS): `resolveQuote` (SOL / listed / **pump coin** via
    `resolveQuoteMint` + `fetchPumpQuote`), `buildCreate` with `pumpQuote` accounts, `readChain`, sweep +
    collect (v2 for token quotes), `buy_exact_quote_in_v3` curve buys, PumpSwap buys, `multiHopBuy` /
    `multiHopSellToSol`, burns, prices from curve / pool reserves.
  - `stack.js` — the registry: every live coin, its base layer / depth / chain, epochs; registers `$L1`.
  - `tracker.js` — prices read **through the chain** (price in quote × quote's USD, `$L1` first), pots, samples.
  - `launcher.js` — launch: deposit → metadata → `create_v2` quoted in the base layer → multi-hop dev buy → tokens to the user.
  - `settlement.js` — the settlement: claim → self buy + burn → burn the layer below → ops; gas refills by selling a slice down the chain.
  - `api.js` — `/api/stack`, `/api/coins`, `/api/coin/:mint(/runs|/chart|/trades)`, `/api/runs`,
    `/api/launch/options`, `/api/launch/check/:mint`, `POST /api/launch`, `/api/launch/:id`, uploads, admin.
  - `db.js` (schema + advisory lock), `config.js`, `crypto.js` (AES-256-GCM wallet secrets), `solana.js`.
- `backend/scripts` — `launch-l1.mjs` (deploy `$L1`, dry run by default), `rollup.mjs` (launch a layer on a
  base coin from the CLI — simulates `create_v2` with the pump-quote accounts for free), `chain.mjs <mint>` (a
  coin's chain, depth, the depth gate, what a layer on it would get).
- `backend/public` — the page: `index.html` (STACK · LAUNCH · LAYERS · coin page · SETTLEMENT · DOCS),
  `sprite.js` (palette, sprites, icons), `scene.js` (the stack: the `$L1` slab, a block per layer, logos on the
  blocks, packets settling down, burns), `brand.html` → `icon.png`, `og.png`.

## Run

```bash
cd backend && cp .env.example .env     # MASTER_KEY, L1_MINT, L1_WALLET_PRIVATE_KEY, RPC_URL
createdb layers
npm install && npm run dev             # http://localhost:4000
```

Without `L1_MINT` the page runs in "genesis pending" mode. Without the L1 key `$L1` runs dry; launched
layers always run (their keys are in the table, encrypted). `SCHEDULER_ENABLED=false` is the kill switch.
`DRY_RUN=true` computes every settlement without moving anything.

```bash
node scripts/launch-l1.mjs --name L1 --symbol L1 --image public/icon.png --live   # deploy the base layer
node scripts/chain.mjs <mint>                                                      # inspect a coin's chain
node scripts/rollup.mjs --parent <mint> --name "My L2" --symbol MYL2               # dry-run a depth-N create
```

## Hosting

Railway builds the repo root (`Dockerfile` here, Root Directory empty) with a Postgres plugin.
Vercel serves `backend/public`; `vercel.json` proxies `/api/*` and `/l/*` to Railway and rewrites `/c/*`
to the page. Set `SITE_URL` / `PUBLIC_API_URL` accordingly.

## Notes

- Dev buys route from SOL with `multi_hop_swap`; three hops fit a legacy transaction, so depth ≤ 2 is covered.
  Deeper (if pump.fun raises the gate) needs a lookup table — the launcher skips the dev buy and keeps the SOL
  as the coin wallet's gas reserve, and says so.
- A base layer whose chain has a coin with a complete curve but no pool yet is refused by pump.fun
  (`QuoteCurveAwaitingMigration`); the launch form checks the chain before taking a deposit.
- Nested coins are on no candle API: prices come from the chain, charts from the engine's own samples.

## Deploy, step by step

**Railway (the engine + API)**
1. New project → Deploy from GitHub repo → this repo. Add the **Postgres** plugin (it sets `DATABASE_URL`).
2. Service → Settings → *Root Directory* empty (the `Dockerfile` and `railway.toml` are at the repo root).
3. Variables: `L1_MINT`, `L1_WALLET_PRIVATE_KEY`, `MASTER_KEY` (`openssl rand -hex 32`), `RPC_URL` (an
   indexed RPC — Helius / Chainstack), `SITE_URL` (the Vercel URL), `PUBLIC_API_URL` (the Railway URL),
   `BRAND_TWITTER`, `ADMIN_KEY`. Leave `L1_MINT` empty until `$L1` is deployed.
4. Fund the L1 wallet with ~0.05 SOL of gas. `/api/health` must answer `ok: true`.

**Vercel (the page)**
1. New project → same repo → *Root Directory* = `backend/public`, framework "Other", no build command.
2. Edit `backend/public/vercel.json`: replace `REPLACE-WITH-RAILWAY-URL` with the Railway service URL.
3. Deploy. The page calls `/api/*` on its own origin; Vercel proxies it to Railway.
