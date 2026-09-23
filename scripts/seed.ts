/** Load the fictional demo dataset and demo user.  Usage: npm run db:seed  [-- --force] */
import { openDb, runMigrations } from "../src/lib/db/client";
import { DEMO_USER, seedDemo, seedDemoUser, upsertSources } from "../src/lib/db/seed";
import { config } from "../src/lib/config";

async function main() {
  const db = await openDb();
  await runMigrations(db);
  await upsertSources(db);
  if (config.dataMode === "live") console.warn("Note: DATA_MODE resolves to 'live'. Demo records will be stored but clearly labelled as Demo Data.");
  const seeded = await seedDemo(db, { force: process.argv.includes("--force") });
  await seedDemoUser(db);
  console.log(seeded ? "Demo dataset loaded." : "Demo dataset already present (use --force to reload).");
  console.log(`Demo login: ${DEMO_USER.email} / ${DEMO_USER.password}`);
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
