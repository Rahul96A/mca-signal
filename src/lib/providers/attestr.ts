/**
 * Third-Party Aggregated Data: Attestr "corpx" business APIs (licensed; https://docs.attestr.com).
 *
 * Verified from public docs 2026-09-23:
 *   POST https://api.attestr.com/api/v2/public/corpx/business/master   body {reg, charges, efilings}
 *     → master data + directorsAndSignatories + charges + efilings + addresses + previousName
 *   POST https://api.attestr.com/api/v2/public/corpx/business/search   body {businessName:{matchCriteria,matchValue,enableFuzzy}, limit}
 *     → [{indexId (CIN/LLPIN), businessName, status, incorporatedDate, addresses}]
 *   Header: Authorization: Basic {authToken}. Dates are DD-MM-YYYY.
 * Not provided: structured financial statements (P&L / balance sheet figures).
 * Privacy: director PAN numbers are returned by the API but deliberately never stored or shown.
 */
import { config } from "../config";
import { fetchWithRetry, UpstreamError } from "../http";
import { LLPIN_RE } from "../identifiers";
import { hashPayload } from "../db/persist";
import { FORM_CATALOG, describeForm } from "../domain/forms";
import { SOURCES } from "./sources";
import type { DataProvider, ProviderEntityBundle, ProviderSearchHit, RawAddress, RawCharge, RawDirectorRole, RawFiling } from "./types";

export interface AttestrAddress {
  type?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  active?: boolean | null;
  establishmentDate?: string | null;
  fullAddress?: string | null;
}
export interface AttestrDirector {
  din?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  name?: string | null;
  appointmentDate?: string | null;
  roleCessationDate?: string | null;
  role?: string | null;
  designation?: string | null;
  designationEffectiveDate?: string | null;
  isCurrentSignatory?: boolean | null;
  type?: string | null;
}
export interface AttestrCharge {
  chargeId?: string | null;
  chargeHolder?: string | null;
  amount?: string | number | null;
  createdDate?: string | null;
  modifiedDate?: string | null;
  satisfiedDate?: string | null;
  chargeStatus?: string | null;
}
export interface AttestrFiling {
  srn?: string | null;
  eform?: string | null;
  filed?: string | null;
  description?: string | null;
}
export interface AttestrMaster {
  valid: boolean;
  message?: string;
  reg?: string;
  businessName?: string;
  rocCode?: string;
  category?: string | string[];
  subCategory?: string;
  class?: string;
  type?: string;
  authorizedCapital?: string | number | null;
  paidCapital?: string | number | null;
  obligation?: string | number | null;
  incorporatedDate?: string;
  email?: string | null;
  listed?: boolean | null;
  lastAGMDate?: string | null;
  lastBSDate?: string | null;
  status?: string | null;
  partners?: number | null;
  designatedPartners?: number | null;
  previousName?: string | null;
  industryDivision?: string | null;
  industrySection?: string | null;
  addresses?: AttestrAddress[];
  directorsAndSignatories?: AttestrDirector[];
  charges?: AttestrCharge[];
  efilings?: AttestrFiling[];
  updated?: number | null;
}

/** DD-MM-YYYY → YYYY-MM-DD (null for anything else). */
export function ddmmyyyy(v: string | null | undefined): string | null {
  const m = v?.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === "" || String(v).trim() === "NA" ? null : String(v).trim());

const FORM_KEYS = Object.keys(FORM_CATALOG).map((k) => ({ key: k, norm: k.toUpperCase().replace(/[^A-Z0-9]/g, "") }));
/** "Form AOC-4(XBRL)" / "AOC4" / "MGT 7A" → catalogue form types where recognisable. */
export function normalizeFormType(eform: string): string {
  const llp = eform.toUpperCase().replace(/[^A-Z0-9]/g, "").match(/^(?:LLP)?(?:E?FORM)(\d{1,2})$/);
  if (llp) return `LLP Form ${llp[1]}`; // LLP e-forms are numbered ("Form 11", "LLP Form 8")
  const raw = eform.toUpperCase().replace(/^E?-?FORM\s*/, "").trim();
  const compact = raw.replace(/[^A-Z0-9]/g, "");
  if (/^AOC4.*XBRL/.test(compact)) return "AOC-4 XBRL";
  if (/^AOC4.*CFS/.test(compact)) return "AOC-4 CFS";
  const exact = FORM_KEYS.find((f) => f.norm === compact);
  if (exact) return exact.key;
  const prefix = FORM_KEYS.filter((f) => compact.startsWith(f.norm)).sort((a, b) => b.norm.length - a.norm.length)[0];
  return prefix ? prefix.key : raw;
}

export function mapAttestrMaster(json: AttestrMaster, identifier: string, sourceId: string): ProviderEntityBundle | null {
  if (!json.valid) return null;
  const id = (json.reg ?? identifier).toUpperCase();
  const isLlp = LLPIN_RE.test(id);
  const updated = json.updated ? new Date(json.updated).toISOString() : null;

  // Only the current registered office: Attestr marks past addresses (active=false) without end
  // dates, so they can't be placed on a timeline and are not stored rather than guessed.
  const addresses: RawAddress[] = (json.addresses ?? [])
    .filter((a) => a.fullAddress && /registered/i.test(a.type ?? "") && a.active !== false)
    .map((a) => ({
      addressType: "registered",
      line: a.fullAddress!.replace(/\s+/g, " ").trim(),
      city: str(a.city),
      state: str(a.state),
      pincode: str(a.zip),
      effectiveFrom: ddmmyyyy(a.establishmentDate),
    }));

  // "FO User" rows are MCA filing-portal user registrations, not appointments.
  const seen = new Set<string>();
  const directors: RawDirectorRole[] = [];
  for (const d of json.directorsAndSignatories ?? []) {
    if (!d.din || (d.type ?? "").toLowerCase() === "fo user") continue;
    const name = str(d.name) ?? [d.firstName, d.middleName, d.lastName].map(str).filter(Boolean).join(" ");
    if (!name) continue;
    const appointed = ddmmyyyy(d.appointmentDate) ?? ddmmyyyy(d.designationEffectiveDate);
    const key = `${d.din}|${appointed}`;
    if (seen.has(key)) continue;
    seen.add(key);
    directors.push({
      din: d.din.padStart(8, "0"),
      name: name.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()),
      designation: str(d.designation) ?? str(d.role),
      appointmentDate: appointed,
      cessationDate: ddmmyyyy(d.roleCessationDate),
    });
  }

  const charges: RawCharge[] = (json.charges ?? [])
    .filter((c) => c.chargeId)
    .map((c) => {
      const satisfied = ddmmyyyy(c.satisfiedDate);
      const closed = /closed|satisf/i.test(c.chargeStatus ?? "") || Boolean(satisfied);
      return {
        chargeId: String(c.chargeId),
        holderName: str(c.chargeHolder) ?? "Unknown charge holder",
        amount: num(c.amount),
        creationDate: ddmmyyyy(c.createdDate),
        modificationDate: ddmmyyyy(c.modifiedDate),
        satisfactionDate: satisfied,
        status: closed ? ("satisfied" as const) : ("open" as const),
      };
    });

  const filings: RawFiling[] = (json.efilings ?? [])
    .filter((f) => f.eform)
    .map((f) => {
      const formType = normalizeFormType(f.eform!);
      return {
        formType,
        formDescription: describeForm(formType) ?? str(f.description) ?? str(f.eform),
        financialYear: null, // not supplied by the source — never inferred
        filingDate: ddmmyyyy(f.filed),
        status: "Filed",
        srn: str(f.srn),
        documentAvailable: true,
        documentUrl: null,
        sourceRecordId: str(f.srn),
      };
    });

  const category = Array.isArray(json.category) ? json.category.join(", ") : str(json.category);
  return {
    sourceId,
    rawResponseHash: hashPayload(json),
    entity: {
      kind: isLlp ? "llp" : "company",
      identifier: id,
      name: (json.businessName ?? id).toUpperCase(),
      status: str(json.status),
      companyClass: isLlp ? null : str(json.class),
      category,
      subCategory: str(json.subCategory),
      listingStatus: json.listed === true ? "Listed" : json.listed === false ? "Unlisted" : null,
      incorporationDate: ddmmyyyy(json.incorporatedDate),
      roc: str(json.rocCode),
      state: addresses[0]?.state ?? null,
      industry: str(json.industrySection)?.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) ?? null,
      principalActivity: str(json.industryDivision),
      authorizedCapital: isLlp ? null : num(json.authorizedCapital),
      paidUpCapital: isLlp ? null : num(json.paidCapital),
      totalContribution: isLlp ? num(json.obligation) : null,
      numberOfPartners: json.partners ?? null,
      numberOfDesignatedPartners: json.designatedPartners ?? null,
      email: str(json.email),
      lastAgmDate: ddmmyyyy(json.lastAGMDate),
      lastBalanceSheetDate: ddmmyyyy(json.lastBSDate),
      sourceRecordId: id,
      lastUpdatedAt: updated,
    },
    addresses: addresses.length ? addresses : undefined,
    nameHistory: str(json.previousName) ? [{ previousName: str(json.previousName)!.toUpperCase(), changedOn: null }] : [],
    directors,
    filings,
    charges,
    // financials intentionally undefined: not supplied by this API
  };
}

export class AttestrProvider implements DataProvider {
  readonly source = { ...SOURCES.thirdParty, name: "Attestr MCA business API (licensed)", url: "https://docs.attestr.com" };
  readonly capabilities = {
    masterData: true,
    nameSearch: "fuzzy" as const,
    directors: true,
    filings: true,
    financials: false,
    charges: true,
    directorLookup: false,
    bulkSync: false,
  };

  isConfigured() {
    return config.mcaProvider === "attestr" && Boolean(config.mcaProviderApiKey);
  }

  private base() {
    return (config.mcaProviderBaseUrl || "https://api.attestr.com").replace(/\/+$/, "");
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetchWithRetry(`${this.base()}${path}`, {
      method: "POST",
      headers: { Authorization: `Basic ${config.mcaProviderApiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      retries: 2,
      timeoutMs: 60_000,
      minIntervalMs: 200,
    });
    return (await res.json()) as T;
  }

  async fetchEntity(identifier: string): Promise<ProviderEntityBundle | null> {
    try {
      const json = await this.post<AttestrMaster>("/api/v2/public/corpx/business/master", { reg: identifier, charges: true, efilings: true });
      return mapAttestrMaster(json, identifier, this.source.id);
    } catch (e) {
      if (e instanceof UpstreamError && (e.status === 404 || e.status === 400)) return null;
      throw e;
    }
  }

  async search(query: string, limit: number): Promise<ProviderSearchHit[]> {
    const rows = await this.post<Array<{ indexId?: string; businessName?: string; status?: string; incorporatedDate?: string; addresses?: AttestrAddress[] }>>(
      "/api/v2/public/corpx/business/search",
      { businessName: { matchCriteria: "CONTAINS", matchValue: query.trim(), enableFuzzy: true }, skip: 0, limit, sort: "score", sortOrder: -1 },
    );
    return (Array.isArray(rows) ? rows : [])
      .filter((r) => r.indexId && r.businessName)
      .map((r) => {
        const reg = r.addresses?.find((a) => /registered/i.test(a.type ?? "")) ?? r.addresses?.[0];
        return {
          kind: LLPIN_RE.test(r.indexId!.toUpperCase()) ? ("llp" as const) : ("company" as const),
          identifier: r.indexId!.toUpperCase(),
          name: r.businessName!.toUpperCase(),
          status: r.status ?? null,
          state: reg?.state ?? null,
          incorporationDate: ddmmyyyy(r.incorporatedDate),
        };
      });
  }
}
