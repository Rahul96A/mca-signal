/**
 * Orchestration: identifier → (DB | providers → normalise → DB) → analysis → cached dossier.
 */
import { config } from "../config";
import { cached, getCache } from "../cache";
import { getDb, type Db } from "../db/client";
import { persistBundle } from "../db/persist";
import {
  getCharges,
  getDirectorRoles,
  getFilings,
  getFinancialRows,
  getProfile,
  getRolesForDirectorIds,
  getSources,
} from "../db/repository";
import { detectIdentifier } from "../identifiers";
import { logger, errorMessage } from "../logger";
import { liveProviders } from "../providers/registry";
import type { ProviderCapabilities } from "../providers/types";
import type { Charge, DataQuality, DataSource, DirectorRole, EntityProfile, Filing, RiskSignal } from "../domain/types";
import { analyzeFinancials, buildFinancialRecords, type FinancialAnalysis } from "../analysis/financials";
import { computeSignals, type RelatedEntity } from "../analysis/risk";
import { computeDataQuality } from "../analysis/quality";
import { NotFoundError, UpstreamUnavailableError, ValidationError } from "./errors";

export interface Dossier {
  profile: EntityProfile;
  directors: DirectorRole[] | null;
  filings: Filing[] | null;
  financials: FinancialAnalysis | null;
  charges: Charge[] | null;
  related: RelatedEntity[];
  signals: RiskSignal[];
  quality: DataQuality;
  sources: DataSource[];
  dataMode: "demo" | "live";
  generatedAt: string;
}

const inflight = new Map<string, Promise<void>>();

export function parseEntityIdentifier(raw: string): string {
  const id = detectIdentifier(raw);
  if (id.kind !== "cin" && id.kind !== "llpin") throw new ValidationError("Identifier must be a valid CIN (21 characters) or LLPIN (e.g. AAB-1234)");
  return id.value;
}

function isStale(p: EntityProfile) {
  if (p.provenance.sourceCategory === "demo" || !p.provenance.fetchedAt) return false;
  return Date.now() - Date.parse(p.provenance.fetchedAt) > config.entityStaleHours * 3600 * 1000;
}

/** Fetch an entity from every configured live provider (priority order) and persist with provenance. */
export async function syncEntity(db: Db, identifier: string): Promise<{ found: boolean; errors: string[] }> {
  const errors: string[] = [];
  let found = false;
  let masterSource: string | null = null;
  for (const p of liveProviders()) {
    const log = await db.query<{ id: string }>(
      `insert into data_sync_logs (source_id, job_type, entity_identifier, status) values ($1,'entity_fetch',$2,'running') returning id`,
      [p.source.id, identifier],
    );
    try {
      let bundle = await p.fetchEntity(identifier);
      // The first (highest-priority, i.e. official) provider owns the master record; later providers
      // only contribute the sections it lacks, so fields are never attributed to the wrong source.
      if (bundle?.entity && masterSource) bundle = { ...bundle, entity: undefined };
      if (!bundle) {
        await db.query(`update data_sync_logs set status='success', finished_at=now(), meta=$2 where id=$1`, [log[0].id, JSON.stringify({ found: false })]);
        continue;
      }
      const { owner, upserted } = await persistBundle(db, bundle, identifier);
      found = found || Boolean(owner);
      if (owner && bundle.entity) masterSource = p.source.id;
      await db.query(`update data_sources set last_synced_at = now() where id = $1`, [p.source.id]);
      await db.query(`update data_sync_logs set status='success', finished_at=now(), records_fetched=1, records_upserted=$2 where id=$1`, [log[0].id, upserted]);
    } catch (e) {
      errors.push(`${p.source.id}: ${errorMessage(e)}`);
      logger.error("provider fetch failed", { provider: p.source.id, identifier, error: errorMessage(e) });
      await db.query(`update data_sync_logs set status='error', finished_at=now(), error=$2 where id=$1`, [log[0].id, errorMessage(e).slice(0, 1000)]);
    }
  }
  await getCache().del(`entity:${identifier}`);
  return { found, errors };
}

/** Resolve a CIN/LLPIN to a stored profile, fetching from live providers when missing or stale. */
export async function resolveEntity(raw: string) {
  const identifier = parseEntityIdentifier(raw);
  const db = await getDb();
  let found = await getProfile(db, identifier);
  if (liveProviders().length && (!found || isStale(found.profile))) {
    let job = inflight.get(identifier);
    if (!job) {
      job = syncEntity(db, identifier)
        .then(({ errors, found: ok }) => {
          if (!ok && errors.length) throw new UpstreamUnavailableError(errors.join("; "));
        })
        .finally(() => inflight.delete(identifier));
      inflight.set(identifier, job);
    }
    try {
      await job;
    } catch (e) {
      if (!found) throw e; // serve stale data if we have it
      logger.warn("serving stale entity after provider failure", { identifier });
    }
    found = await getProfile(db, identifier);
  }
  if (!found) throw new NotFoundError(`No company or LLP found for ${identifier}`);
  return { db, identifier, ...found };
}

type Section = keyof Pick<ProviderCapabilities, "directors" | "filings" | "financials" | "charges">;
function sectionSupported(section: Section, count: number, profile: EntityProfile) {
  if (count > 0) return true;
  if (profile.provenance.sourceCategory === "demo") return true;
  return liveProviders().some((p) => p.capabilities[section]);
}

async function buildDossier(raw: string): Promise<Dossier> {
  const { db, profile, owner } = await resolveEntity(raw);
  const [directorsRaw, filingsRaw, finRows, chargesRaw, sources] = await Promise.all([
    getDirectorRoles(db, owner),
    getFilings(db, owner, profile.companyClass),
    getFinancialRows(db, owner),
    getCharges(db, owner),
    getSources(db),
  ]);
  const directors = sectionSupported("directors", directorsRaw.length, profile) ? directorsRaw : null;
  const filings = sectionSupported("filings", filingsRaw.items.length, profile) ? filingsRaw.items : null;
  const financials = sectionSupported("financials", finRows.length, profile) ? analyzeFinancials(buildFinancialRecords(finRows)) : null;
  const charges = sectionSupported("charges", chargesRaw.length, profile) ? chargesRaw : null;

  const roles = await getRolesForDirectorIds(db, [...new Set(directorsRaw.map((d) => d.directorId))]);
  const relatedMap = new Map<string, RelatedEntity>();
  for (const r of roles) {
    if (r.entity_identifier === profile.identifier || relatedMap.has(r.entity_identifier)) continue;
    relatedMap.set(r.entity_identifier, {
      identifier: r.entity_identifier,
      name: r.entity_name,
      kind: r.entity_kind,
      status: r.entity_status,
      viaDin: r.din,
      viaName: r.director_name,
    });
  }
  const related = [...relatedMap.values()];
  const signals = computeSignals({ profile, directors, filings, financials, charges, related });
  const quality = computeDataQuality({ profile, directors, filings, financials: financials?.years ?? null, charges });
  const usedSourceIds = new Set([
    profile.provenance.sourceId,
    ...directorsRaw.map((d) => d.provenance.sourceId),
    ...filingsRaw.items.map((f) => f.provenance.sourceId),
    ...finRows.map((f) => f.provenance.sourceId),
    ...chargesRaw.map((c) => c.provenance.sourceId),
  ]);
  return {
    profile,
    directors,
    filings,
    financials,
    charges,
    related,
    signals,
    quality,
    sources: sources.filter((s) => usedSourceIds.has(s.id)),
    dataMode: config.dataMode,
    generatedAt: new Date().toISOString(),
  };
}

export async function getDossier(raw: string): Promise<Dossier> {
  const identifier = parseEntityIdentifier(raw);
  return cached(`entity:${identifier}:dossier`, config.cacheTtlSeconds, () => buildDossier(identifier));
}
