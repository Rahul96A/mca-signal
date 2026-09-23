/**
 * Official Government Data: Open Government Data (OGD) Platform India — data.gov.in.
 *
 * Verified 2026-09-23 against the live API:
 *   GET https://api.data.gov.in/resource/4dbe5667-7b6b-41d7-82af-211562424d9a?api-key=KEY&format=json
 *   "Registrars of Companies (RoC)-wise Company Master Data" — ~3.67M records (companies AND LLPs,
 *   LLPs carry their LLPIN in the CIN field), dataset updated 2026-07-22.
 *   Fields: CIN, CompanyName, CompanyROCcode, CompanyCategory, CompanySubCategory, CompanyClass,
 *   AuthorizedCapital, PaidupCapital, CompanyRegistrationdate_date, Registered_Office_Address,
 *   Listingstatus, CompanyStatus, CompanyStateCode, "CompanyIndian/Foreign Company", nic_code,
 *   CompanyIndustrialClassification.
 *   Filters are EXACT, case-sensitive keyword matches (filters[CIN]=…, filters[CompanyName]=…,
 *   filters[CompanyStateCode]=…). No fuzzy search → we bulk-sync into Postgres and search locally.
 *   The dataset contains master data only: no directors, filings, financial statements or charges.
 *   API key is mandatory (free registration) and passed as a query parameter — server-side only.
 *   Licence: Government Open Data License – India (GODL).
 */
import { config } from "../config";
import { fetchWithRetry } from "../http";
import { LLPIN_RE } from "../identifiers";
import { hashPayload } from "../db/persist";
import { logger, errorMessage } from "../logger";
import { SOURCES } from "./sources";
import type { DataProvider, ProviderEntityBundle, ProviderSearchHit, RawAddress } from "./types";

const BASE = "https://api.data.gov.in/resource";

export interface OgdRecord {
  CIN?: string;
  CompanyName?: string;
  CompanyROCcode?: string;
  CompanyCategory?: string;
  CompanySubCategory?: string;
  CompanyClass?: string;
  AuthorizedCapital?: string | number;
  PaidupCapital?: string | number;
  CompanyRegistrationdate_date?: string;
  Registered_Office_Address?: string;
  Listingstatus?: string;
  CompanyStatus?: string;
  CompanyStateCode?: string;
  "CompanyIndian/Foreign Company"?: string;
  nic_code?: string;
  CompanyIndustrialClassification?: string;
}

interface OgdResponse {
  status?: string;
  message?: string;
  total?: number;
  updated_date?: string;
  records?: OgdRecord[];
}

const blank = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" || s.toUpperCase() === "NA" ? null : s;
};
const money = (v: unknown): number | null => {
  const s = blank(v);
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const titleCase = (s: string | null) => (s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : null);

export function parseOgdAddress(raw: string | null, state: string | null): RawAddress | null {
  if (!raw) return null;
  const pin = raw.match(/\b(\d{6})\b/);
  return { addressType: "registered", line: raw.replace(/\s+/g, " ").trim(), pincode: pin ? pin[1] : null, state, country: "India" };
}

/** Map one OGD record into the provider contract. Exported for unit tests. */
export function mapOgdRecord(r: OgdRecord, datasetUpdated: string | null): ProviderEntityBundle | null {
  const id = blank(r.CIN)?.toUpperCase();
  const name = blank(r.CompanyName);
  if (!id || !name) return null;
  const isLlp = LLPIN_RE.test(id);
  const state = titleCase(blank(r.CompanyStateCode));
  const reg = blank(r.CompanyRegistrationdate_date);
  const address = parseOgdAddress(blank(r.Registered_Office_Address), state);
  return {
    sourceId: SOURCES.ogd.id,
    rawResponseHash: hashPayload(r),
    entity: {
      kind: isLlp ? "llp" : "company",
      identifier: id,
      name: name.toUpperCase(),
      status: blank(r.CompanyStatus),
      companyClass: blank(r.CompanyClass),
      category: blank(r.CompanyCategory),
      subCategory: blank(r.CompanySubCategory),
      listingStatus: blank(r.Listingstatus),
      origin: blank(r["CompanyIndian/Foreign Company"]),
      incorporationDate: reg && /^\d{4}-\d{2}-\d{2}/.test(reg) ? reg.slice(0, 10) : null,
      roc: blank(r.CompanyROCcode),
      state,
      nicCode: blank(r.nic_code),
      industry: blank(r.CompanyIndustrialClassification),
      principalActivity: null,
      authorizedCapital: money(r.AuthorizedCapital),
      paidUpCapital: money(r.PaidupCapital),
      sourceRecordId: id,
      publishedAt: datasetUpdated,
      lastUpdatedAt: datasetUpdated,
    },
    addresses: address ? [address] : undefined,
  };
}

const SUFFIX_RE = /\b(PRIVATE LIMITED|LIMITED|LLP)$/;

/**
 * Registered-name variants for an exact-match lookup: "infosys" → INFOSYS, INFOSYS LIMITED,
 * INFOSYS PRIVATE LIMITED, INFOSYS LLP (+ the mixed-case form some LLP names are stored in).
 * Common abbreviations are expanded ("pvt ltd" → PRIVATE LIMITED). Exported for tests.
 */
export function nameVariants(query: string): string[] {
  const cleaned = query.trim().replace(/\s+/g, " ").replace(/\.(?=\s|$)/g, "");
  if (cleaned.length < 3) return [];
  const upper = cleaned
    .toUpperCase()
    .replace(/\bPVT\b/g, "PRIVATE")
    .replace(/\bLTD\b/g, "LIMITED")
    .replace(/\bCO\b(?= (PRIVATE|LIMITED))/g, "COMPANY")
    .replace(/&/g, "AND")
    .trim();
  const out = [upper];
  if (!SUFFIX_RE.test(upper)) {
    out.push(`${upper} PRIVATE LIMITED`, `${upper} LIMITED`, `${upper} LLP`);
    const title = cleaned.replace(/\b\w+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
    out.push(`${title} LLP`);
  } else if (upper.endsWith(" LLP")) {
    out.push(cleaned.replace(/\b\w+/g, (w) => (w.toUpperCase() === "LLP" ? "LLP" : w[0].toUpperCase() + w.slice(1).toLowerCase())));
  }
  if (upper.includes("AND") && cleaned.includes("&")) out.push(...out.map((v) => v.replace(/\bAND\b/g, "&")));
  return [...new Set(out)];
}

export class DataGovProvider implements DataProvider {
  readonly source = SOURCES.ogd;
  readonly capabilities = {
    masterData: true,
    nameSearch: "exact" as const,
    directors: false,
    filings: false,
    financials: false,
    charges: false,
    directorLookup: false,
    bulkSync: true,
  };

  isConfigured() {
    return Boolean(config.dataGovApiKey);
  }

  private async request(params: Record<string, string | number>): Promise<OgdResponse> {
    const url = new URL(`${BASE}/${config.dataGovResourceId}`);
    url.searchParams.set("api-key", config.dataGovApiKey);
    url.searchParams.set("format", "json");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetchWithRetry(url.toString(), { retries: 3, timeoutMs: 45_000, minIntervalMs: 300, headers: { Accept: "application/json" } });
    const json = (await res.json()) as OgdResponse;
    if (json.status && json.status !== "ok") throw new Error(`data.gov.in error: ${json.message ?? json.status}`);
    return json;
  }

  async fetchEntity(identifier: string) {
    const json = await this.request({ limit: 1, "filters[CIN]": identifier });
    const rec = json.records?.[0];
    return rec ? mapOgdRecord(rec, json.updated_date ?? null) : null;
  }

  /**
   * Live name search. The API only supports exact, case-sensitive name filters (no wildcard or
   * full-text), so we query the registered-name variants a user most likely means.
   */
  async search(query: string, limit: number): Promise<ProviderSearchHit[]> {
    const hits = new Map<string, ProviderSearchHit>();
    const variants = nameVariants(query);
    let failures = 0;
    let lastError: unknown = null;
    // Variants run concurrently (the per-host throttle still staggers request starts).
    const responses = await Promise.all(
      variants.map((name) =>
        this.request({ limit, "filters[CompanyName]": name }).catch((e) => {
          failures++;
          lastError = e;
          logger.warn("data.gov.in name variant failed", { name, error: errorMessage(e) });
          return { records: [] } as OgdResponse;
        }),
      ),
    );
    // Every call failed (e.g. 429 rate limit): surface it instead of reporting "no matches",
    // which would also be cached.
    if (variants.length && failures === variants.length) throw lastError;
    for (const json of responses) {
      for (const r of json.records ?? []) {
        const b = mapOgdRecord(r, json.updated_date ?? null);
        if (!b?.entity || hits.has(b.entity.identifier)) continue;
        hits.set(b.entity.identifier, {
          kind: b.entity.kind,
          identifier: b.entity.identifier,
          name: b.entity.name,
          status: b.entity.status,
          state: b.entity.state,
          incorporationDate: b.entity.incorporationDate,
        });
      }
      if (hits.size >= limit) break;
    }
    return [...hits.values()].slice(0, limit);
  }

  async fetchMasterPage({ offset, limit, stateCode }: { offset: number; limit: number; stateCode?: string }) {
    const params: Record<string, string | number> = { offset, limit };
    if (stateCode) params["filters[CompanyStateCode]"] = stateCode;
    const json = await this.request(params);
    const bundles = (json.records ?? []).map((r) => mapOgdRecord(r, json.updated_date ?? null)).filter((b): b is ProviderEntityBundle => b !== null);
    return { bundles, total: Number(json.total ?? 0) };
  }
}
