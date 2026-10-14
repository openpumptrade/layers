import postgres from "postgres";
import { config } from "./config.js";

const ssl = config.databaseUrl.includes("localhost") || config.databaseUrl.includes("127.0.0.1") ? false : "require";
export const sql = postgres(config.databaseUrl, { max: 8, idle_timeout: 30, ssl, transform: { undefined: null }, onnotice: () => {} });

/// Idempotent schema — runs at boot (Railway has no shell for migrations).
/// Quote amounts are in UI units of the coin's quote (SOL for the trunk, the parent coin otherwise);
/// coin amounts in UI units of the coin (6 decimals); usd/sol columns say so.
export async function ensureSchema() {
  await sql`create table if not exists meta (key text primary key, value text not null)`;

  // one row per coin on the tree: the launch (custodial wallet, deposit, pump.fun txs), its place in the tree and live stats
  await sql`create table if not exists coins (
    launch_id text primary key,
    mint text unique,
    status text not null default 'awaiting_deposit',   -- awaiting_deposit · launching · live · failed · expired · refunded
    error text not null default '',
    is_root boolean not null default false,
    wallet text not null,
    wallet_secret_enc text not null default '',
    user_wallet text not null default '',
    name text not null,
    symbol text not null,
    description text not null default '',
    image text not null default '',
    image_upload_id text not null default '',
    website text not null default '',
    twitter text not null default '',
    telegram text not null default '',
    -- the tree
    parent_mint text not null default '',               -- '' for the trunk (quoted in SOL)
    depth int not null default 0,
    chain text not null default '[]',                   -- json: mints from the trunk up to the parent
    quote_mint text not null default '',                -- what the coin trades in (WSOL for the trunk)
    quote_decimals int not null default 6,
    quote_token_program text not null default '',
    -- the launch
    dev_buy_sol double precision not null default 0,
    deposit_expected_sol double precision not null default 0,
    creator_tax_bps int not null default 0,
    created_at timestamptz not null default now(),
    launched_at timestamptz,
    launch_tx text not null default '',
    dev_buy_tx text not null default '',
    dev_transfer_tx text not null default '',
    refund_tx text not null default '',
    token_program text not null default '',
    created_ts_ms bigint not null default 0,
    pool text not null default '',
    graduated boolean not null default false,
    -- live numbers
    supply0 double precision not null default 0,
    supply double precision not null default 0,
    burned double precision not null default 0,
    price_quote double precision not null default 0,    -- price in the coin's quote
    price_usd double precision not null default 0,
    mcap_usd double precision not null default 0,
    price_updated_at int not null default 0,
    holders_est int not null default 0,
    volume24h_usd double precision not null default 0,
    pot_unclaimed double precision not null default 0,  -- creator fees waiting (vaults + the v3 curve bucket), in quote
    pot_wallet_quote double precision not null default 0,
    pot_wallet_sol double precision not null default 0,
    pot_wallet_tokens double precision not null default 0,
    pot_updated_at int not null default 0,
    cycles_run int not null default 0,
    total_claimed_quote double precision not null default 0,
    total_self_quote double precision not null default 0,
    total_self_burned double precision not null default 0,
    total_down_quote double precision not null default 0,
    total_ops_quote double precision not null default 0,
    total_sap_usd double precision not null default 0,
    ops_owed_quote double precision not null default 0,
    last_cycle_at int not null default 0,
    last_note text not null default ''
  )`;
  await sql`create index if not exists coins_status on coins (status)`;
  await sql`create index if not exists coins_parent on coins (parent_mint)`;
  await sql`create index if not exists coins_user on coins (user_wallet)`;

  // the sap runs: one row per coin per cycle — sweep + claim → self buy + burn → parent burn → ops
  await sql`create table if not exists runs (
    id serial primary key, mint text not null, cycle int not null, ts int not null,
    status text not null default 'claiming',
    dry boolean not null default false,
    pot_quote double precision not null default 0,
    claimed_quote double precision not null default 0,
    self_quote double precision not null default 0,
    self_burned double precision not null default 0,
    down_quote double precision not null default 0,
    ops_quote double precision not null default 0,
    gas_quote double precision not null default 0,
    quote_usd double precision, price_usd double precision, sol_usd double precision, supply_after double precision,
    venue text, claim_tx text, buy_tx text, burn_tx text, down_tx text, ops_tx text, gas_tx text,
    note text, finished_at int)`;
  await sql`create index if not exists runs_mint on runs (mint, id)`;
  await sql`create index if not exists runs_ts on runs (ts)`;

  // logos (base64 in Postgres, served at /api/uploads/:id)
  await sql`create table if not exists uploads (id text primary key, mime text not null, data text not null, created_at timestamptz not null default now())`;

  // price samples per coin for the charts (nested coins are not on any candle API)
  await sql`create table if not exists samples (mint text not null, ts int not null, price_usd double precision not null, mcap_usd double precision not null, primary key (mint, ts))`;
}

export async function getMeta(key, fallback = null) {
  const rows = await sql`select value from meta where key = ${key}`;
  return rows.length ? rows[0].value : fallback;
}
export async function setMeta(key, value) {
  await sql`insert into meta (key, value) values (${key}, ${String(value)})
    on conflict (key) do update set value = excluded.value`;
}

/// Railway runs the old and the new container side by side during a redeploy: only the process holding
/// this advisory lock moves money. Held on a reserved connection (no idle timeout).
let lockSql = null;
export async function acquireEngineLock() {
  lockSql = postgres(config.databaseUrl, { max: 1, idle_timeout: 0, max_lifetime: null, ssl, onnotice: () => {} });
  for (;;) {
    const [{ ok }] = await lockSql`select pg_try_advisory_lock(hashtext('root-engine')) as ok`;
    if (ok) return true;
    console.warn("[db] another engine holds the lock — waiting");
    await new Promise((r) => setTimeout(r, 5_000));
  }
}
