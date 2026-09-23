/**
 * Background data-synchronisation worker.
 *   npm run worker            → loop every WORKER_INTERVAL_MINUTES (default 360)
 *   npm run sync:ogd          → run once and exit
 * Jobs: data.gov.in bulk master-data import (resumable, per state) + refresh of stale entities.
 * Use with PostgreSQL (DATABASE_URL). With embedded PGlite, the database can only be opened by one
 * process — stop `npm run dev` first, or trigger jobs through POST /api/admin/sync instead.
 */
import { openDb, runMigrations } from "../src/lib/db/client";
import { upsertSources } from "../src/lib/db/seed";
import { config } from "../src/lib/config";
import { logger, errorMessage } from "../src/lib/logger";
import { refreshStaleEntities, runOgdBulkSync } from "../src/lib/services/sync-service";

const once = process.argv.includes("--once");
const intervalMin = Number(process.env.WORKER_INTERVAL_MINUTES ?? 360);
const maxPages = Number(process.env.WORKER_MAX_PAGES ?? 20);

async function tick() {
  const db = await openDb();
  try {
    await runMigrations(db);
    await upsertSources(db);
    if (config.dataGovApiKey) {
      const summary = await runOgdBulkSync(db, { maxPages });
      logger.info("worker: ogd bulk sync", { summary });
    } else {
      logger.warn("worker: DATA_GOV_API_KEY not set — skipping data.gov.in bulk sync");
    }
    if (config.dataMode === "live") {
      const r = await refreshStaleEntities(db);
      logger.info("worker: refreshed stale entities", r);
    }
  } catch (e) {
    logger.error("worker tick failed", { error: errorMessage(e) });
  } finally {
    await db.close();
  }
}

async function main() {
  if (!config.databaseUrl) logger.warn("worker: running against embedded PGlite; make sure the web server is not using the same PGLITE_DATA_DIR");
  await tick();
  if (once) return;
  logger.info(`worker: next run in ${intervalMin} minutes`);
  setInterval(() => void tick(), intervalMin * 60_000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
