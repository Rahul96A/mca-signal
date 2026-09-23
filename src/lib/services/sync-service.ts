/**
 * Background synchronisation jobs (run by scripts/worker.ts or POST /api/admin/sync):
 *  - ogd_bulk: page through data.gov.in master data (optionally per state) into the local DB so
 *    fuzzy search works over the official register. Resumable via data_sync_logs.meta.offset.
 *  - refresh_stale: re-fetch entities whose provider data is older than ENTITY_STALE_HOURS.
 */
import { config } from "../config";
import type { Db } from "../db/client";
import { persistBundle } from "../db/persist";
import { logger, errorMessage } from "../logger";
import { DataGovProvider } from "../providers/datagov";
import { SOURCES } from "../providers/sources";
import { syncEntity } from "./entity-service";

export async function runOgdBulkSync(db: Db, opts: { maxPages?: number; stateCode?: string } = {}) {
  const provider = new DataGovProvider();
  if (!provider.isConfigured()) throw new Error("DATA_GOV_API_KEY is not configured");
  const states = opts.stateCode ? [opts.stateCode] : config.dataGovSyncStates.length ? config.dataGovSyncStates : [undefined];
  const summary: Array<{ state: string; fetched: number; upserted: number; total: number; status: string }> = [];

  for (const state of states) {
    const jobType = `ogd_bulk:${state ?? "all"}`;
    // resume from the last successful offset for this job type
    const last = await db.query<{ meta: { nextOffset?: number } | null }>(
      `select meta from data_sync_logs where job_type = $1 and status in ('success','partial') order by started_at desc limit 1`,
      [jobType],
    );
    let offset = last[0]?.meta?.nextOffset ?? 0;
    const log = await db.query<{ id: string }>(`insert into data_sync_logs (source_id, job_type, status, meta) values ($1,$2,'running',$3) returning id`, [SOURCES.ogd.id, jobType, JSON.stringify({ startOffset: offset })]);
    let fetched = 0;
    let upserted = 0;
    let total = 0;
    let status: "success" | "partial" | "error" = "success";
    let error: string | null = null;
    try {
      for (let page = 0; page < (opts.maxPages ?? 20); page++) {
        const res = await provider.fetchMasterPage({ offset, limit: config.dataGovPageSize, stateCode: state });
        total = res.total;
        for (const b of res.bundles) upserted += (await persistBundle(db, b)).upserted;
        fetched += res.bundles.length;
        offset += res.bundles.length;
        if (res.bundles.length < config.dataGovPageSize || offset >= total) {
          offset = 0; // completed a full pass; next run starts over to pick up updates
          break;
        }
        if (page === (opts.maxPages ?? 20) - 1) status = "partial";
      }
      await db.query(`update data_sources set last_synced_at = now() where id = $1`, [SOURCES.ogd.id]);
    } catch (e) {
      status = fetched ? "partial" : "error";
      error = errorMessage(e);
      logger.error("ogd bulk sync failed", { state, error });
    }
    await db.query(
      `update data_sync_logs set status=$2, finished_at=now(), records_fetched=$3, records_upserted=$4, error=$5, meta=$6 where id=$1`,
      [log[0].id, status, fetched, upserted, error, JSON.stringify({ nextOffset: offset, total })],
    );
    summary.push({ state: state ?? "all", fetched, upserted, total, status });
    logger.info("ogd bulk sync finished", { state, fetched, upserted, total, status });
  }
  return summary;
}

export async function refreshStaleEntities(db: Db, limit = 50) {
  const rows = await db.query<{ identifier: string }>(
    `select cin as identifier from companies where source_id <> 'demo' and fetched_at < now() - ($1 || ' hours')::interval
     union all
     select llpin from llps where source_id <> 'demo' and fetched_at < now() - ($1 || ' hours')::interval
     limit $2`,
    [String(config.entityStaleHours), limit],
  );
  let ok = 0;
  for (const r of rows) {
    const res = await syncEntity(db, r.identifier);
    if (res.found) ok++;
  }
  return { checked: rows.length, refreshed: ok };
}
