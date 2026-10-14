import { config, mode } from "./config.js";
import { ensureSchema, acquireEngineLock } from "./db.js";
import { loadRegistry, rootCoin, liveCoins } from "./tree.js";
import { startTracker } from "./tracker.js";
import { startLauncher } from "./launcher.js";
import { startSap } from "./sap.js";
import { startApi } from "./api.js";

/// ROOT. A launchpad where every coin grows on another coin. One process: the tree (registry) +
/// tracker (prices through the chain) + grow (launches with pump-coin quotes) + the sap run + API + page.

async function main() {
  await ensureSchema();
  if (!config.rootMint) {
    startApi(false);
    console.log("[boot] no ROOT_MINT — serving the page in 'not planted yet' mode");
    return;
  }
  await loadRegistry();
  const root = rootCoin();
  console.log(`[boot] $${root.symbol} ${root.mint} · trunk wallet ${root.wallet} · ${liveCoins().length - 1} coins grown · mode ${mode()} · dryRun ${config.dryRun} · scheduler ${config.schedulerEnabled}`);
  startApi(true);
  await startTracker();
  await acquireEngineLock();
  startLauncher();
  await startSap();
}

main().catch((err) => { console.error("[boot] fatal:", err); process.exit(1); });
