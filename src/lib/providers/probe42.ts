/**
 * Third-Party Aggregated Data: Probe42 V1 REST API (licensed; access via Probe42 sales).
 *
 * Probe42's own docs are behind a login. The contract below comes from a public integration that
 * committed a recorded sandbox response (github.com/shrayash-s45/p42-watchout, 2026-06) — verify
 * against your account's API reference before production use.
 *   GET {base}/companies/{CIN}/comprehensive-details   (LLPs: /llps/{LLPIN}/comprehensive-details)
 *   Headers: x-api-key, Accept: application/json, x-api-version: 1.3
 *   Sandbox base https://api.probe42.in/probe_pro_sandbox (≈150 whitelisted entities only);
 *   production base https://api.probe42.in.
 *   404 "not probed yet" → POST /companies/{CIN}/update starts an async probe (hours).
 *   429 = rate limited or out of credits. Money values are raw rupees.
 * Supplies: master data, authorized signatories, charge history, name history and multi-year
 * financial statements (P&L + balance sheet from AOC-4/XBRL). Name search is not used because its
 * filter schema is unconfirmed.
 * Privacy: director PAN, date of birth, age, gender, father's name and address are never stored.
 */
import { config } from "../config";
import { fetchWithRetry, UpstreamError } from "../http";
import { LLPIN_RE } from "../identifiers";
import { hashPayload } from "../db/persist";
import { logger, errorMessage } from "../logger";
import { SOURCES } from "./sources";
import type { DataProvider, ProviderEntityBundle, RawCharge, RawDirectorRole, RawFinancial } from "./types";

type Num = number | string | null | undefined;

export interface P42Financial {
  year?: string;
  nature?: string; // STANDALONE | CONSOLIDATED
  stated_on?: string;
  bs?: {
    assets?: { given_assets_total?: Num };
    liabilities?: { share_capital?: Num; long_term_borrowings?: Num; short_term_borrowings?: Num };
    subTotals?: { total_equity?: Num; total_debt?: Num };
  };
  pnl?: {
    lineItems?: {
      net_revenue?: Num;
      other_income?: Num;
      depreciation?: Num;
      interest?: Num;
      profit_before_tax?: Num;
      profit_after_tax?: Num;
    };
    revenue_breakup?: { revenue_from_operations?: Num };
  };
}

export interface P42Response {
  metadata?: { last_updated?: string };
  data?: {
    company?: Record<string, unknown>;
    llp?: Record<string, unknown>;
    name_history?: Array<{ name?: string; date?: string }>;
    authorized_signatories?: Array<{
      din?: string;
      name?: string;
      designation?: string;
      din_status?: string;
      nationality?: string;
      date_of_appointment?: string;
      date_of_appointment_for_current_designation?: string;
      date_of_cessation?: string | null;
    }>;
    open_charges?: Array<{ id?: number | string; date?: string; holder_name?: string; amount?: Num; type?: string }>;
    charge_sequence?: Array<{
      charge_id?: number | string;
      status?: string; // Creation | Modification | Satisfaction
      date?: string;
      amount?: Num;
      holder_name?: string;
      property_type?: string;
    }>;
    financials?: P42Financial[];
  };
}

const num = (v: Num): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
const isoDate = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/** Period end "2025-03-31" → financial-year label "2024-25". */
export function fyFromPeriodEnd(periodEnd: string): string | null {
  const m = periodEnd.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const start = Number(m[2]) <= 3 ? year - 1 : year;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Only values Probe42 reports are mapped; EBITDA / total liabilities are left for the app to calculate and label. */
export function mapP42Financials(list: P42Financial[] = []): RawFinancial[] {
  // Prefer standalone statements; use consolidated only when a company has no standalone ones,
  // and never mix the two in one series.
  const standalone = list.filter((f) => (f.nature ?? "").toUpperCase() === "STANDALONE");
  const chosen = standalone.length ? standalone : list.filter((f) => (f.nature ?? "").toUpperCase() === "CONSOLIDATED");
  const byFy = new Map<string, RawFinancial>();
  for (const f of chosen) {
    const end = isoDate(f.year) ?? isoDate(f.stated_on);
    const fy = end ? fyFromPeriodEnd(end) : null;
    if (!end || !fy || byFy.has(fy)) continue;
    const li = f.pnl?.lineItems ?? {};
    const bs = f.bs ?? {};
    const lt = num(bs.liabilities?.long_term_borrowings);
    const st = num(bs.liabilities?.short_term_borrowings);
    byFy.set(fy, {
      financialYear: fy,
      periodEnd: end,
      revenue: num(li.net_revenue) ?? num(f.pnl?.revenue_breakup?.revenue_from_operations),
      otherIncome: num(li.other_income),
      depreciation: num(li.depreciation),
      financeCost: num(li.interest),
      profitBeforeTax: num(li.profit_before_tax),
      profitAfterTax: num(li.profit_after_tax),
      netWorth: num(bs.subTotals?.total_equity),
      totalAssets: num(bs.assets?.given_assets_total),
      borrowings: num(bs.subTotals?.total_debt) ?? (lt !== null || st !== null ? (lt ?? 0) + (st ?? 0) : null),
      paidUpCapital: num(bs.liabilities?.share_capital),
    });
  }
  return [...byFy.values()].sort((a, b) => a.financialYear.localeCompare(b.financialYear));
}

/** Collapse Probe42's per-event charge_sequence into one row per charge. */
export function mapP42Charges(d: P42Response["data"] = {}): RawCharge[] {
  const byId = new Map<string, RawCharge>();
  const events = [...(d.charge_sequence ?? [])].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
  for (const e of events) {
    if (e.charge_id === undefined || e.charge_id === null) continue;
    const id = String(e.charge_id);
    const c = byId.get(id) ?? { chargeId: id, holderName: str(e.holder_name) ?? "Unknown charge holder", amount: null, creationDate: null, modificationDate: null, satisfactionDate: null, status: "open" as const, propertyDescription: null };
    const status = (e.status ?? "").toLowerCase();
    const date = isoDate(e.date);
    if (status.startsWith("creat")) c.creationDate = c.creationDate ?? date;
    else if (status.startsWith("modif")) c.modificationDate = date ?? c.modificationDate;
    else if (status.startsWith("satisf")) {
      c.satisfactionDate = date;
      c.status = "satisfied";
    }
    if (num(e.amount) !== null) c.amount = num(e.amount);
    if (str(e.holder_name)) c.holderName = str(e.holder_name)!;
    if (str(e.property_type)) c.propertyDescription = str(e.property_type);
    byId.set(id, c);
  }
  // Open charges not present in the event history.
  for (const o of d.open_charges ?? []) {
    if (o.id === undefined || o.id === null || byId.has(String(o.id))) continue;
    const date = isoDate(o.date);
    const isMod = /modif/i.test(o.type ?? "");
    byId.set(String(o.id), {
      chargeId: String(o.id),
      holderName: str(o.holder_name) ?? "Unknown charge holder",
      amount: num(o.amount),
      creationDate: isMod ? null : date,
      modificationDate: isMod ? date : null,
      satisfactionDate: null,
      status: "open",
    });
  }
  return [...byId.values()];
}

function classParts(classification: string | null) {
  const c = (classification ?? "").toLowerCase();
  return {
    companyClass: c.includes("one person") ? "One Person Company" : c.includes("private") ? "Private" : c.includes("public") ? "Public" : null,
    subCategory: c.includes("non-government") || c.includes("non government") ? "Non-government company" : c.includes("government") ? "Government company" : null,
  };
}

export function mapP42Response(json: P42Response, identifier: string, sourceId: string): ProviderEntityBundle | null {
  const d = json.data;
  const e = d?.company ?? d?.llp;
  if (!d || !e) return null;
  const isLlp = LLPIN_RE.test(identifier) || Boolean(d.llp);
  const id = (str(e.cin) ?? str(e.llpin) ?? identifier).toUpperCase();
  const reg = (e.registered_address ?? {}) as Record<string, unknown>;
  const cls = classParts(str(e.classification));
  const listing = str(e.status);

  const directors: RawDirectorRole[] = (d.authorized_signatories ?? [])
    .filter((s) => s.din && s.name)
    .map((s) => ({
      din: String(s.din).padStart(8, "0"),
      name: String(s.name).replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()),
      nationality: str(s.nationality),
      dinStatus: str(s.din_status),
      designation: str(s.designation),
      appointmentDate: isoDate(s.date_of_appointment) ?? isoDate(s.date_of_appointment_for_current_designation),
      cessationDate: isoDate(s.date_of_cessation),
    }));

  const lastUpdated = isoDate(json.metadata?.last_updated);
  return {
    sourceId,
    rawResponseHash: hashPayload(json),
    entity: {
      kind: isLlp ? "llp" : "company",
      identifier: id,
      name: (str(e.legal_name) ?? id).toUpperCase(),
      status: str(e.efiling_status) ?? str(e.status),
      companyClass: isLlp ? null : cls.companyClass,
      subCategory: isLlp ? null : cls.subCategory,
      listingStatus: listing && /listed/i.test(listing) ? (/unlisted/i.test(listing) ? "Unlisted" : "Listed") : null,
      incorporationDate: isoDate(e.incorporation_date),
      state: str(reg.state),
      authorizedCapital: isLlp ? null : num(e.authorized_capital as Num),
      paidUpCapital: isLlp ? null : num(e.paid_up_capital as Num),
      totalContribution: isLlp ? num((e.total_obligation_of_contribution ?? e.total_contribution) as Num) : null,
      email: str(e.email),
      lastAgmDate: isoDate(e.last_agm_date),
      lastBalanceSheetDate: isoDate(e.last_filing_date),
      sourceRecordId: id,
      lastUpdatedAt: lastUpdated,
    },
    addresses: str(reg.full_address)
      ? [{ addressType: "registered", line: str(reg.full_address)!.replace(/\s+/g, " "), city: str(reg.city), state: str(reg.state), pincode: str(reg.pincode) }]
      : undefined,
    nameHistory: (d.name_history ?? []).filter((n) => n.name).map((n) => ({ previousName: String(n.name).toUpperCase(), changedOn: isoDate(n.date) })),
    directors,
    charges: mapP42Charges(d),
    financials: mapP42Financials(d.financials),
    // filings intentionally not mapped: the comprehensive endpoint only carries the latest
    // AOC-4 / MGT-7 dates, and a partial list would make older years look "missing".
  };
}

export class Probe42Provider implements DataProvider {
  readonly source = { ...SOURCES.thirdParty, name: "Probe42 API (licensed)", url: "https://probe42.in" };
  readonly capabilities = {
    masterData: true,
    nameSearch: "none" as const,
    directors: true,
    filings: false,
    financials: true,
    charges: true,
    directorLookup: false,
    bulkSync: false,
  };

  isConfigured() {
    return config.mcaProvider === "probe42" && Boolean(config.mcaProviderApiKey);
  }

  private base() {
    if (config.mcaProviderBaseUrl) return config.mcaProviderBaseUrl.replace(/\/+$/, "");
    return process.env.PROBE42_ENV === "production" ? "https://api.probe42.in" : "https://api.probe42.in/probe_pro_sandbox";
  }

  private headers(extra: Record<string, string> = {}) {
    return { "x-api-key": config.mcaProviderApiKey, Accept: "application/json", "x-api-version": process.env.PROBE42_API_VERSION || "1.3", ...extra };
  }

  async fetchEntity(identifier: string): Promise<ProviderEntityBundle | null> {
    const kind = LLPIN_RE.test(identifier) ? "llps" : "companies";
    try {
      const res = await fetchWithRetry(`${this.base()}/${kind}/${encodeURIComponent(identifier)}/comprehensive-details`, {
        headers: this.headers(),
        retries: 2,
        timeoutMs: 60_000,
        minIntervalMs: 250,
      });
      return mapP42Response((await res.json()) as P42Response, identifier, this.source.id);
    } catch (e) {
      if (e instanceof UpstreamError && e.status === 404) {
        if (/not probed/i.test(e.body ?? "") && kind === "companies") await this.requestProbe(identifier);
        return null;
      }
      if (e instanceof UpstreamError && e.status === 422) return null;
      throw e;
    }
  }

  /** Ask Probe42 to fetch an entity it hasn't indexed yet; data becomes available on a later refresh. */
  private async requestProbe(cin: string) {
    try {
      const res = await fetchWithRetry(`${this.base()}/companies/${encodeURIComponent(cin)}/update`, { method: "POST", headers: this.headers(), retries: 1 });
      const body = (await res.json().catch(() => ({}))) as { data?: { request_id?: string }; request_id?: string };
      logger.info("probe42: requested probe for unindexed company", { cin, requestId: body.data?.request_id ?? body.request_id ?? null });
    } catch (e) {
      logger.warn("probe42: probe request failed", { cin, error: errorMessage(e) });
    }
  }
}
