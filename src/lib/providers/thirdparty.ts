/**
 * Third-Party Aggregated Data. There is no public MCA API for directors, filings, financial
 * statements or charges; these are only available programmatically via licensed aggregators.
 *
 * Two adapters:
 *  - "sandbox": Sandbox.co.in company master data (POST /kyc/mca/company/master-data), JWT from
 *    POST /authenticate (x-api-key + x-api-secret → data.access_token, valid 24h). Verified from
 *    public docs 2026-09-23. Master data only.
 *  - "generic": any vendor (or your own licensed proxy) that implements the small REST contract in
 *    docs/PROVIDERS.md. Responses are validated with zod before they touch the database.
 *
 * Never scrape mca.gov.in: its master-data and document pages are CAPTCHA/login protected.
 */
import { z } from "zod";
import { config } from "../config";
import { fetchWithRetry, UpstreamError } from "../http";
import { LLPIN_RE } from "../identifiers";
import { hashPayload } from "../db/persist";
import { SOURCES } from "./sources";
import type { DataProvider, ProviderEntityBundle, ProviderSearchHit } from "./types";

const d = z.string().nullish(); // ISO date
const n = z.number().nullish();

const entitySchema = z.object({
  kind: z.enum(["company", "llp"]),
  identifier: z.string(),
  name: z.string(),
  status: z.string().nullish(),
  companyClass: z.string().nullish(),
  category: z.string().nullish(),
  subCategory: z.string().nullish(),
  listingStatus: z.string().nullish(),
  incorporationDate: d,
  roc: z.string().nullish(),
  state: z.string().nullish(),
  nicCode: z.string().nullish(),
  industry: z.string().nullish(),
  principalActivity: z.string().nullish(),
  authorizedCapital: n,
  paidUpCapital: n,
  totalContribution: n,
  email: z.string().nullish(),
  lastAgmDate: d,
  lastBalanceSheetDate: d,
  lastUpdatedAt: d,
});

export const genericBundleSchema = z.object({
  entity: entitySchema,
  addresses: z.array(z.object({ line: z.string(), city: z.string().nullish(), state: z.string().nullish(), pincode: z.string().nullish(), effectiveFrom: d, effectiveTo: d })).optional(),
  nameHistory: z.array(z.object({ previousName: z.string(), changedOn: d })).optional(),
  directors: z
    .array(z.object({ din: z.string(), name: z.string(), designation: z.string().nullish(), appointmentDate: d, cessationDate: d, nationality: z.string().nullish() }))
    .optional(),
  filings: z
    .array(
      z.object({
        formType: z.string(),
        formDescription: z.string().nullish(),
        financialYear: z.string().nullish(),
        filingDate: d,
        dueDate: d,
        eventDate: d,
        status: z.string().nullish(),
        srn: z.string().nullish(),
        documentAvailable: z.boolean().optional(),
        documentUrl: z.string().url().nullish(),
      }),
    )
    .optional(),
  financials: z
    .array(
      z.object({
        financialYear: z.string(),
        periodEnd: d,
        revenue: n, otherIncome: n, totalIncome: n, totalExpenses: n, depreciation: n, financeCost: n,
        profitBeforeTax: n, profitAfterTax: n, ebitda: n, netWorth: n, totalAssets: n, totalLiabilities: n,
        borrowings: n, paidUpCapital: n, filingSrn: z.string().nullish(),
      }),
    )
    .optional(),
  charges: z
    .array(
      z.object({
        chargeId: z.string(),
        holderName: z.string(),
        amount: n,
        creationDate: d,
        modificationDate: d,
        satisfactionDate: d,
        status: z.enum(["open", "satisfied"]).optional(),
        propertyDescription: z.string().nullish(),
      }),
    )
    .optional(),
});

const searchSchema = z.object({
  results: z.array(z.object({ kind: z.enum(["company", "llp"]), identifier: z.string(), name: z.string(), status: z.string().nullish(), state: z.string().nullish(), incorporationDate: d })),
});

let sandboxToken: { token: string; expires: number } | null = null;

export class ThirdPartyMcaProvider implements DataProvider {
  readonly source = { ...SOURCES.thirdParty, url: config.mcaProviderBaseUrl };

  get capabilities() {
    const generic = config.mcaProvider === "generic";
    return {
      masterData: true,
      nameSearch: generic ? ("fuzzy" as const) : ("none" as const),
      directors: generic,
      filings: generic,
      financials: generic,
      charges: generic,
      directorLookup: generic,
      bulkSync: false,
    };
  }

  isConfigured() {
    return (config.mcaProvider === "generic" || config.mcaProvider === "sandbox") && Boolean(config.mcaProviderApiKey && config.mcaProviderBaseUrl);
  }

  private base() {
    return config.mcaProviderBaseUrl.replace(/\/+$/, "");
  }

  private async sandboxAuth(): Promise<string> {
    if (sandboxToken && sandboxToken.expires > Date.now()) return sandboxToken.token;
    const res = await fetchWithRetry(`${this.base()}/authenticate`, {
      method: "POST",
      headers: { "x-api-key": config.mcaProviderApiKey, "x-api-secret": config.mcaProviderApiSecret, "x-api-version": "1.0" },
      retries: 2,
    });
    const json = (await res.json()) as { data?: { access_token?: string } };
    const token = json.data?.access_token;
    if (!token) throw new Error("Sandbox authentication returned no access_token");
    sandboxToken = { token, expires: Date.now() + 23 * 3600 * 1000 };
    return token;
  }

  private async genericGet(path: string): Promise<unknown | null> {
    try {
      const res = await fetchWithRetry(`${this.base()}${path}`, {
        headers: { Authorization: `Bearer ${config.mcaProviderApiKey}`, Accept: "application/json" },
        retries: 3,
        minIntervalMs: 200,
      });
      return await res.json();
    } catch (e) {
      if (e instanceof UpstreamError && e.status === 404) return null;
      throw e;
    }
  }

  async fetchEntity(identifier: string): Promise<ProviderEntityBundle | null> {
    if (config.mcaProvider === "sandbox") {
      if (LLPIN_RE.test(identifier)) return null; // endpoint documented for CINs only
      const token = await this.sandboxAuth();
      let res: Response;
      try {
        res = await fetchWithRetry(`${this.base()}/kyc/mca/company/master-data`, {
          method: "POST",
          headers: { Authorization: token, "x-api-key": config.mcaProviderApiKey, "x-api-version": "1.0", "Content-Type": "application/json" },
          body: JSON.stringify({ cin: identifier }),
          retries: 2,
        });
      } catch (e) {
        if (e instanceof UpstreamError && (e.status === 404 || e.status === 422)) return null;
        throw e;
      }
      const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
      const r = json.data?.[0];
      if (!r) return null;
      const s = (k: string) => (r[k] === undefined || r[k] === null || r[k] === "" ? null : String(r[k]));
      const num = (k: string) => (s(k) === null ? null : Number(String(r[k]).replace(/,/g, "")));
      return {
        sourceId: this.source.id,
        rawResponseHash: hashPayload(json),
        entity: {
          kind: "company",
          identifier,
          name: String(r.company_name ?? identifier).toUpperCase(),
          status: s("company_status"),
          companyClass: s("company_class"),
          category: s("company_category"),
          subCategory: s("company_sub_category"),
          listingStatus: s("listing_status"),
          origin: s("company_origin"),
          incorporationDate: s("company_registration_date")?.slice(0, 10) ?? null,
          roc: s("company_roc_code"),
          state: s("company_state_code"),
          nicCode: s("nic_code"),
          industry: s("company_industrial_classification"),
          authorizedCapital: num("authorized_capital"),
          paidUpCapital: num("paidup_capital"),
          sourceRecordId: identifier,
          lastUpdatedAt: s("updated_at"),
        },
        addresses: s("registered_office_address") ? [{ line: s("registered_office_address")!, addressType: "registered" }] : undefined,
      };
    }

    const json = await this.genericGet(`/entities/${encodeURIComponent(identifier)}`);
    if (!json) return null;
    const parsed = genericBundleSchema.parse(json);
    return { sourceId: this.source.id, rawResponseHash: hashPayload(json), ...parsed, entity: { ...parsed.entity, sourceRecordId: parsed.entity.identifier } };
  }

  async search(query: string, limit: number): Promise<ProviderSearchHit[]> {
    if (config.mcaProvider !== "generic") return [];
    const json = await this.genericGet(`/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    return json ? searchSchema.parse(json).results : [];
  }

  async fetchDirectorEntities(din: string): Promise<ProviderSearchHit[]> {
    if (config.mcaProvider !== "generic") return [];
    const json = await this.genericGet(`/directors/${encodeURIComponent(din)}/entities`);
    return json ? searchSchema.parse(json).results : [];
  }
}
