/**
 * Database access layer. Uses PostgreSQL (node-postgres) when DATABASE_URL is set, otherwise an
 * embedded PGlite database so the app runs with zero external services. Both expose the same
 * minimal `Db` interface, so repositories contain plain SQL that works on either.
 */
import { config } from "../config";
import { logger, errorMessage } from "../logger";
import { MIGRATIONS, TRIGRAM_SQL } from "./migrations";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly driver: "postgres" | "pglite";
  trigramAvailable: boolean;
}

// Normalise driver type conversions: dates as 'YYYY-MM-DD', timestamps as ISO strings, numerics as numbers.
const OID = { INT8: 20, NUMERIC: 1700, DATE: 1082, TIMESTAMP: 1114, TIMESTAMPTZ: 1184 };
const toIso = (v: string) => {
  const d = new Date(v.includes("T") ? v : v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
};
const PARSERS: Record<number, (v: string) => unknown> = {
  [OID.INT8]: (v) => Number(v),
  [OID.NUMERIC]: (v) => Number(v),
  [OID.DATE]: (v) => v,
  [OID.TIMESTAMP]: toIso,
  [OID.TIMESTAMPTZ]: toIso,
};

async function createPostgres(url: string): Promise<Db> {
  const pg = await import("pg");
  const { Pool, types } = pg.default ?? pg;
  for (const [oid, fn] of Object.entries(PARSERS)) types.setTypeParser(Number(oid), fn);
  const pool = new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
  pool.on("error", (e: Error) => logger.error("pg pool error", { error: e.message }));
  // Relax pg_trgm thresholds (defaults 0.3 / 0.6) so typo'd names still reach the re-ranker.
  pool.on("connect", (c: { query: (s: string) => Promise<unknown> }) => {
    c.query(TRGM_SETTINGS).catch(() => {});
  });

  const wrap = (runner: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }): Omit<Db, "transaction" | "close" | "driver" | "trigramAvailable"> => ({
    async query<T>(sql: string, params: unknown[] = []) {
      return (await runner.query(sql, params)).rows as T[];
    },
    async exec(sql: string) {
      await runner.query(sql);
    },
  });

  const db: Db = {
    ...wrap(pool),
    driver: "postgres",
    trigramAvailable: false,
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const tx: Db = { ...wrap(client), driver: "postgres", trigramAvailable: db.trigramAvailable, transaction: (f) => f(tx), close: async () => {} };
        const out = await fn(tx);
        await client.query("commit");
        return out;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  return db;
}

async function createPglite(dataDir: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  let extensions: Record<string, unknown> = {};
  try {
    const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
    extensions = { pg_trgm };
  } catch (e) {
    logger.warn("pg_trgm extension unavailable for PGlite; falling back to ILIKE search", { error: errorMessage(e) });
  }
  if (dataDir !== "memory://") {
    const fs = await import("node:fs");
    fs.mkdirSync(dataDir, { recursive: true });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pglite: any = await PGlite.create(dataDir === "memory://" ? undefined : dataDir, {
    extensions,
    parsers: PARSERS,
  } as never);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrap = (runner: any) => ({
    async query<T>(sql: string, params: unknown[] = []) {
      return (await runner.query(sql, params)).rows as T[];
    },
    async exec(sql: string) {
      await runner.exec(sql);
    },
  });

  const db: Db = {
    ...wrap(pglite),
    driver: "pglite",
    trigramAvailable: false,
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return pglite.transaction(async (t: any) => {
        const tx: Db = { ...wrap(t), driver: "pglite", trigramAvailable: db.trigramAvailable, transaction: (f) => f(tx), close: async () => {} };
        return fn(tx);
      });
    },
    close: () => pglite.close(),
  };
  return db;
}

export async function runMigrations(db: Db, opts: { reset?: boolean } = {}) {
  if (opts.reset) {
    await db.exec(`drop schema public cascade; create schema public;`);
  }
  await db.exec(`create table if not exists schema_migrations (version int primary key, name text not null, applied_at timestamptz not null default now());`);
  const applied = new Set((await db.query<{ version: number }>(`select version from schema_migrations`)).map((r) => Number(r.version)));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    logger.info("applying migration", { version: m.version, name: m.name });
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query(`insert into schema_migrations (version, name) values ($1, $2)`, [m.version, m.name]);
    });
  }
  try {
    await db.exec(TRIGRAM_SQL);
    await db.exec(TRGM_SETTINGS);
    db.trigramAvailable = true;
  } catch (e) {
    db.trigramAvailable = false;
    logger.warn("pg_trgm not available; fuzzy search will use application-side scoring", { error: errorMessage(e) });
  }
}

const TRGM_SETTINGS = "set pg_trgm.word_similarity_threshold = 0.3; set pg_trgm.similarity_threshold = 0.3;";

const g = globalThis as unknown as { __mcaDb?: Promise<Db> };

/**
 * Lazily creates the singleton connection, runs migrations and — in demo mode — seeds the demo
 * dataset. Stored on globalThis so Next.js dev hot-reloads don't open duplicate PGlite instances.
 */
export function getDb(): Promise<Db> {
  if (!g.__mcaDb) {
    g.__mcaDb = (async () => {
      const db = config.databaseUrl ? await createPostgres(config.databaseUrl) : await createPglite(config.pgliteDataDir);
      await runMigrations(db);
      const { ensureBaseData } = await import("./seed");
      await ensureBaseData(db);
      logger.info("database ready", { driver: db.driver, dataMode: config.dataMode, trigram: db.trigramAvailable });
      return db;
    })().catch((e) => {
      g.__mcaDb = undefined;
      throw e;
    });
  }
  return g.__mcaDb;
}

/** For tests/scripts: open a dedicated connection without the singleton. */
export async function openDb(): Promise<Db> {
  return config.databaseUrl ? createPostgres(config.databaseUrl) : createPglite(config.pgliteDataDir);
}

export async function resetDbSingleton() {
  if (g.__mcaDb) {
    const db = await g.__mcaDb.catch(() => undefined);
    g.__mcaDb = undefined;
    await db?.close().catch(() => {});
  }
}
