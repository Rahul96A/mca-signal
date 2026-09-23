import { afterEach, describe, expect, it, vi } from "vitest";
import { mapOgdRecord, nameVariants } from "@/lib/providers/datagov";
import { backoffDelay, fetchWithRetry, UpstreamError } from "@/lib/http";
import { toCsv } from "@/lib/services/export-service";
import { validateSections } from "@/lib/services/report-service";
import { checkRateLimit } from "@/lib/api";
import { genericBundleSchema } from "@/lib/providers/thirdparty";

// Records copied from the live data.gov.in API response (resource 4dbe5667-…, 2026-09-23).
const OGD_COMPANY = {
  CIN: "U52100HR2015OPC056314", CompanyName: "COVEY RETAIL (OPC) PRIVATE LIMITED", CompanyROCcode: "ROC Delhi", CompanyCategory: "Company limited by shares",
  CompanySubCategory: "Non-government company", CompanyClass: "One Person Company", AuthorizedCapital: "100000.00", PaidupCapital: "100000.00",
  CompanyRegistrationdate_date: "2015-08-06", Registered_Office_Address: "H.NO. 284   DEFENCE COLONY,HISAR,Haryana,125001-India", Listingstatus: "Unlisted",
  CompanyStatus: "Strike Off", CompanyStateCode: "haryana", "CompanyIndian/Foreign Company": "India", nic_code: "52100", CompanyIndustrialClassification: "Trading",
};
const OGD_LLP = {
  CIN: "ABD-0345", CompanyName: "Titan Winners Fund Management LLP", CompanyROCcode: "ROC Haryana", CompanyCategory: "", CompanySubCategory: "", CompanyClass: "",
  AuthorizedCapital: "", PaidupCapital: "", CompanyRegistrationdate_date: "2023-02-10", Registered_Office_Address: "3rd Floor, Gurgaon,Haryana,India-122102",
  Listingstatus: "", CompanyStatus: "Active", CompanyStateCode: "haryana", "CompanyIndian/Foreign Company": "", nic_code: "", CompanyIndustrialClassification: "Finance",
};

describe("data.gov.in mapping", () => {
  it("maps a company record with provenance", () => {
    const b = mapOgdRecord(OGD_COMPANY, "2026-07-22T08:17:15Z")!;
    expect(b.sourceId).toBe("ogd_datagov");
    expect(b.rawResponseHash).toMatch(/^[a-f0-9]{64}$/);
    expect(b.entity).toMatchObject({ kind: "company", identifier: "U52100HR2015OPC056314", status: "Strike Off", companyClass: "One Person Company", authorizedCapital: 100000, paidUpCapital: 100000, incorporationDate: "2015-08-06", state: "Haryana", publishedAt: "2026-07-22T08:17:15Z" });
    expect(b.addresses?.[0].pincode).toBe("125001");
    // master data only: other sections are "not supplied", not empty
    expect(b.directors).toBeUndefined();
    expect(b.filings).toBeUndefined();
  });

  it("recognises LLPs by LLPIN and blanks empty fields", () => {
    const b = mapOgdRecord(OGD_LLP, null)!;
    expect(b.entity).toMatchObject({ kind: "llp", identifier: "ABD-0345", name: "TITAN WINNERS FUND MANAGEMENT LLP", paidUpCapital: null, companyClass: null });
  });

  it("rejects records without an identifier", () => {
    expect(mapOgdRecord({ CompanyName: "X" }, null)).toBeNull();
  });
});

describe("data.gov.in name variants", () => {
  it("expands a partial name into registered-name variants", () => {
    expect(nameVariants("infosys")).toEqual(["INFOSYS", "INFOSYS PRIVATE LIMITED", "INFOSYS LIMITED", "INFOSYS LLP", "Infosys LLP"]);
  });
  it("expands abbreviations and keeps explicit suffixes", () => {
    expect(nameVariants("Covey Retail (OPC) Pvt. Ltd.")).toEqual(["COVEY RETAIL (OPC) PRIVATE LIMITED"]);
    expect(nameVariants("titan winners fund management llp")).toEqual(["TITAN WINNERS FUND MANAGEMENT LLP", "Titan Winners Fund Management LLP"]);
  });
  it("adds ampersand forms and ignores too-short queries", () => {
    expect(nameVariants("A & B")).toContain("A & B LIMITED");
    expect(nameVariants("ab")).toEqual([]);
  });
});

describe("data.gov.in search failure handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DATA_GOV_API_KEY;
  });

  it("throws when every name variant is rate-limited (so an empty result is never cached)", async () => {
    process.env.DATA_GOV_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("Too Many Requests", { status: 429, headers: { "retry-after": "0" } })));
    const { DataGovProvider } = await import("@/lib/providers/datagov");
    await expect(new DataGovProvider().search("infosys", 10)).rejects.toMatchObject({ status: 429 });
  });

  it("still returns hits when only some variants fail", async () => {
    process.env.DATA_GOV_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) =>
        decodeURIComponent(url.replace(/\+/g, " ")).endsWith("CompanyName]=INFOSYS LIMITED")
          ? new Response(JSON.stringify({ status: "ok", records: [{ CIN: "L85110KA1981PLC013115", CompanyName: "INFOSYS LIMITED", CompanyStatus: "Active" }] }), { status: 200 })
          : new Response("error", { status: 404 }),
      ),
    );
    const { DataGovProvider } = await import("@/lib/providers/datagov");
    const hits = await new DataGovProvider().search("infosys", 10);
    expect(hits.map((h) => h.identifier)).toEqual(["L85110KA1981PLC013115"]);
  });
});

describe("generic third-party contract", () => {
  it("validates bundles and rejects malformed ones", () => {
    expect(genericBundleSchema.safeParse({ entity: { kind: "company", identifier: "U1", name: "X" }, charges: [{ chargeId: "1", holderName: "B", status: "open" }] }).success).toBe(true);
    expect(genericBundleSchema.safeParse({ entity: { kind: "bank", identifier: "U1", name: "X" } }).success).toBe(false);
  });
});

describe("http retry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("honours Retry-After seconds and caps backoff", () => {
    expect(backoffDelay(0, "3")).toBe(3000);
    expect(backoffDelay(0, "999")).toBe(60000);
    expect(backoffDelay(10)).toBeLessThanOrEqual(15000);
  });

  it("retries 429/5xx then succeeds; does not retry 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response("oops", { status: 503, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchWithRetry("https://example.test/x?api-key=secret", { retries: 3 });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    const err = await fetchWithRetry("https://example.test/y?api-key=secret", { retries: 3 }).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.status).toBe(404);
    expect(err.url).not.toContain("secret"); // secrets are redacted in errors/logs
  });
});

describe("csv export", () => {
  it("escapes quotes/commas and neutralises spreadsheet formulas", () => {
    const csv = toCsv([{ a: 'He said "hi", ok', b: "=HYPERLINK(1)", c: null }]);
    expect(csv).toBe('a,b,c\r\n"He said ""hi"", ok",\'=HYPERLINK(1),');
  });
});

describe("AI report citation validation", () => {
  const refs = { "profile:status": { ref: "profile:status", type: "profile" as const, label: "Status" } };
  const titles = { executive_summary: "1. Executive Summary" };
  it("drops uncited or invalidly cited paragraphs and unknown sections", () => {
    const out = validateSections(
      {
        sections: [
          { key: "executive_summary", paragraphs: [{ text: "Valid.", citations: ["profile:status", "made:up"] }, { text: "Uncited claim.", citations: [] }, { text: "Fake cite.", citations: ["filing:nope"] }] },
          { key: "hacker_section", paragraphs: [{ text: "x", citations: ["profile:status"] }] },
        ],
      },
      refs,
      titles,
    );
    expect(out).toEqual([{ key: "executive_summary", title: "1. Executive Summary", paragraphs: [{ text: "Valid.", citations: ["profile:status"] }] }]);
  });
});

describe("rate limiting", () => {
  it("allows up to the limit per window then blocks", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(checkRateLimit("ip-test", 3, t).ok).toBe(true);
    expect(checkRateLimit("ip-test", 3, t).ok).toBe(false);
    expect(checkRateLimit("ip-test", 3, t + 61_000).ok).toBe(true);
  });
});
