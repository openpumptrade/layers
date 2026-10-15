import { config, mode } from "./config.js";
import { ensureSchema, acquireEngineLock } from "./db.js";
import { loadRegistry, l1Coin, liveCoins } from "./stack.js";
import { startTracker } from "./tracker.js";
import { startLauncher } from "./launcher.js";
import { startSettlement } from "./settlement.js";
import { startApi } from "./api.js";

/// LAYERS. Launch your L2 on a memecoin. One process: the stack (registry) + tracker (prices through
/// the chain) + launcher (create_v2 with pump-coin quotes) + the settlement + API + page.

async function main() {
  await ensureSchema();
  if (!config.l1Mint) {
    startApi(false);
    console.log("[boot] no L1_MINT — serving the page in 'genesis pending' mode");
    return;
  }
  await loadRegistry();
  const l1 = l1Coin();
  console.log(`[boot] $${l1.symbol} ${l1.mint} · L1 wallet ${l1.wallet} · ${liveCoins().length - 1} layers launched · mode ${mode()} · dryRun ${config.dryRun} · scheduler ${config.schedulerEnabled}`);
  startApi(true);
  await startTracker();
  await acquireEngineLock();
  startLauncher();
  await startSettlement();
}

main().catch((err) => { console.error("[boot] fatal:", err); process.exit(1); });
