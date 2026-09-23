import bcrypt from "bcryptjs";
import type { Db } from "./client";
import { config } from "../config";
import { logger } from "../logger";
import { SOURCES } from "../providers/sources";
import { DEMO_BUNDLES, DEMO_SOURCE_ID } from "../demo/dataset";
import { persistBundle } from "./persist";

export const DEMO_USER = { email: "demo@mcasignal.local", password: "demo12345", name: "Demo User" };

export async function upsertSources(db: Db) {
  for (const s of Object.values(SOURCES)) {
    await db.query(
      `insert into data_sources (id, name, category, url, license, description)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set name = excluded.name, category = excluded.category, url = excluded.url,
         license = excluded.license, description = excluded.description`,
      [s.id, s.name, s.category, s.url || null, s.license, s.description],
    );
  }
}

export async function seedDemo(db: Db, opts: { force?: boolean } = {}) {
  const existing = await db.query<{ n: number }>(`select count(*)::int as n from companies where source_id = $1`, [DEMO_SOURCE_ID]);
  if (existing[0].n > 0 && !opts.force) return false;
  const started = Date.now();
  let upserted = 0;
  for (const b of DEMO_BUNDLES) upserted += (await persistBundle(db, b)).upserted;
  await db.query(`update data_sources set last_synced_at = now(), published_at = $2 where id = $1`, [DEMO_SOURCE_ID, "2026-07-22"]);
  await db.query(
    `insert into data_sync_logs (source_id, job_type, status, finished_at, records_fetched, records_upserted, meta)
     values ($1, 'demo_seed', 'success', now(), $2, $3, $4)`,
    [DEMO_SOURCE_ID, DEMO_BUNDLES.length, upserted, JSON.stringify({ ms: Date.now() - started })],
  );
  logger.info("demo dataset seeded", { entities: DEMO_BUNDLES.length, records: upserted });
  return true;
}

export async function seedDemoUser(db: Db) {
  const hash = await bcrypt.hash(DEMO_USER.password, 10);
  await db.query(`insert into users (email, name, password_hash) values ($1,$2,$3) on conflict (email) do nothing`, [DEMO_USER.email, DEMO_USER.name, hash]);
}

/** Called on first DB use: registers sources and, in demo mode, loads demo data + demo login. */
export async function ensureBaseData(db: Db) {
  await upsertSources(db);
  if (config.dataMode === "demo") {
    await seedDemo(db);
    await seedDemoUser(db);
  }
}
