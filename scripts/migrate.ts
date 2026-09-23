/** Apply database migrations.  Usage: npm run db:migrate  [-- --reset] */
import { openDb, runMigrations } from "../src/lib/db/client";
import { upsertSources } from "../src/lib/db/seed";
import { config } from "../src/lib/config";

async function main() {
  const reset = process.argv.includes("--reset");
  const db = await openDb();
  console.log(`Migrating ${db.driver} database${config.databaseUrl ? "" : ` at ${config.pgliteDataDir}`}${reset ? " (RESET)" : ""}…`);
  await runMigrations(db, { reset });
  await upsertSources(db);
  console.log(`Done. pg_trgm fuzzy search: ${db.trigramAvailable ? "enabled" : "unavailable (application fallback)"}`);
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
