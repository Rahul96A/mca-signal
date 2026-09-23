import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getSources } from "@/lib/db/repository";
import { providerStatus } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";

/** GET /api/meta/sources — data mode, registered sources, provider configuration and recent sync jobs. */
export const GET = route(async () => {
  const db = await getDb();
  const [sources, logs, counts] = await Promise.all([
    getSources(db),
    db.query(
      `select source_id as "sourceId", job_type as "jobType", entity_identifier as "entityIdentifier", status, started_at as "startedAt",
              finished_at as "finishedAt", records_fetched as "recordsFetched", records_upserted as "recordsUpserted", error
       from data_sync_logs order by started_at desc limit 20`,
    ),
    db.query<{ companies: number; llps: number; directors: number; filings: number }>(
      `select (select count(*)::int from companies) as companies, (select count(*)::int from llps) as llps,
              (select count(*)::int from directors) as directors, (select count(*)::int from filings) as filings`,
    ),
  ]);
  return ok({
    providers: providerStatus(),
    sources,
    syncLogs: logs,
    counts: counts[0],
    database: db.driver,
    fuzzySearch: db.trigramAvailable ? "pg_trgm" : "application",
  });
});
