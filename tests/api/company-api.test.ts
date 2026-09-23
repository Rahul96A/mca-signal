/**
 * End-to-end API tests over the real stack: route handler → service → provider/repository →
 * PGlite (in-memory Postgres, auto-migrated and seeded with demo data).
 */
import { describe, expect, it } from "vitest";
import { call } from "./helpers";
import { GET as searchGET } from "@/app/api/search/route";
import { GET as companyGET } from "@/app/api/companies/[id]/route";
import { GET as llpGET } from "@/app/api/llps/[llpin]/route";
import { GET as directorsGET } from "@/app/api/companies/[id]/directors/route";
import { GET as filingsGET } from "@/app/api/companies/[id]/filings/route";
import { GET as financialsGET } from "@/app/api/companies/[id]/financials/route";
import { GET as chargesGET } from "@/app/api/companies/[id]/charges/route";
import { GET as networkGET } from "@/app/api/companies/[id]/network/route";
import { GET as reportGET } from "@/app/api/companies/[id]/report/route";
import { GET as exportGET } from "@/app/api/companies/[id]/export/route";
import { GET as directorGET } from "@/app/api/directors/[din]/route";
import { GET as sharedGET } from "@/app/api/reports/[token]/route";
import { GET as sourcesGET } from "@/app/api/meta/sources/route";

const AAROHAN = "U01403KA2014PTC999101";
const BRIGHTWAVE = "U63090MH2011PTC999102";
const DECCAN = "U15400TG2012PTC999104";

describe("GET /api/search", () => {
  it("fuzzy-matches names with typos and returns demo provenance", async () => {
    const r = await call(searchGET, "/api/search?q=brihgtwave%20logistcs");
    expect(r.status).toBe(200);
    expect(r.body.data[0]).toMatchObject({ identifier: BRIGHTWAVE, type: "company", sourceCategory: "demo" });
    expect(r.body.meta).toMatchObject({ dataMode: "demo", page: 1 });
  });

  it("finds by exact CIN, LLPIN and DIN", async () => {
    expect((await call(searchGET, `/api/search?q=${AAROHAN.toLowerCase()}`)).body.data[0]).toMatchObject({ identifier: AAROHAN, matchedOn: "identifier" });
    expect((await call(searchGET, "/api/search?q=ZZA-0001")).body.data[0]).toMatchObject({ type: "llp" });
    expect((await call(searchGET, "/api/search?q=99900101")).body.data[0]).toMatchObject({ type: "director", name: "Priya Raghavan" });
  });

  it("searches directors by name and paginates", async () => {
    const r = await call(searchGET, "/api/search?q=agarwal&type=director");
    expect(r.body.data.map((x: { name: string }) => x.name).sort()).toEqual(["Nisha Agarwal", "Suresh Agarwal"]);
    const p = await call(searchGET, "/api/search?q=private&pageSize=2&page=2");
    expect(p.body.data.length).toBeLessThanOrEqual(2);
    expect(p.body.meta.page).toBe(2);
  });

  it("returns empty results for too-short queries", async () => {
    expect((await call(searchGET, "/api/search?q=a")).body.data).toEqual([]);
  });
});

describe("GET /api/companies/:id", () => {
  it("returns the profile with provenance, signals and data quality", async () => {
    const r = await call(companyGET, `/api/companies/${AAROHAN}`, { id: AAROHAN });
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.profile).toMatchObject({ identifier: AAROHAN, kind: "company", status: "Active", roc: "RoC-Bangalore" });
    expect(d.profile.provenance).toMatchObject({ sourceId: "demo", sourceCategory: "demo" });
    expect(d.profile.provenance.fetchedAt).toBeTruthy();
    expect(d.profile.nameHistory[0].previousName).toBe("AAROHAN FARM SOLUTIONS PRIVATE LIMITED");
    expect(d.quality.score).toBeGreaterThan(80);
    expect(d.counts.currentDirectors).toBe(3);
    expect(r.body.meta.sources.map((s: { id: string }) => s.id)).toContain("demo");
  });

  it("validates identifiers and returns 404 for unknown entities", async () => {
    expect((await call(companyGET, "/api/companies/not-a-cin", { id: "not-a-cin" })).status).toBe(400);
    const nf = await call(companyGET, "/api/companies/U99999MH2020PTC999999", { id: "U99999MH2020PTC999999" });
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe("not_found");
  });

  it("serves LLPs via /api/llps/:llpin", async () => {
    const r = await call(llpGET, "/api/llps/ZZA-0001", { llpin: "ZZA-0001" });
    expect(r.body.data.profile).toMatchObject({ kind: "llp", companyClass: "Limited Liability Partnership" });
    expect((await call(llpGET, "/api/llps/U1", { llpin: "U1" })).status).toBe(400);
  });

  it("produces expected due-diligence signals for a company with issues", async () => {
    const b = (await call(companyGET, `/api/companies/${BRIGHTWAVE}`, { id: BRIGHTWAVE })).body.data;
    const ids = b.signals.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["directors-frequent", "filings-delayed", "filings-missing", "address-changes", "activity-losses", "network-inactive-related"]));
    const d = (await call(companyGET, `/api/companies/${DECCAN}`, { id: DECCAN })).body.data;
    expect(d.signals[0]).toMatchObject({ id: "status-inactive", severity: "attention" });
  });
});

describe("section endpoints", () => {
  it("directors: current and former with provenance", async () => {
    const r = await call(directorsGET, "", { id: BRIGHTWAVE });
    expect(r.body.data.directors).toHaveLength(6);
    expect(r.body.data.directors.filter((d: { isCurrent: boolean }) => d.isCurrent)).toHaveLength(3);
  });

  it("filings: paginated, filterable, with delay computation", async () => {
    const p1 = await call(filingsGET, `/api/companies/${BRIGHTWAVE}/filings?page=1&pageSize=5`, { id: BRIGHTWAVE });
    expect(p1.body.data.items).toHaveLength(5);
    expect(p1.body.meta.total).toBeGreaterThan(10);
    const aoc = await call(filingsGET, `/api/companies/${BRIGHTWAVE}/filings?formType=AOC-4&delayedOnly=1`, { id: BRIGHTWAVE });
    expect(aoc.body.data.items.every((f: { formType: string; delayDays: number }) => f.formType === "AOC-4" && f.delayDays > 0)).toBe(true);
    const f = aoc.body.data.items.find((x: { financialYear: string }) => x.financialYear === "2022-23");
    expect(f.delayDays).toBe(113);
  });

  it("financials: reported vs calculated labels, EBITDA not derived when depreciation missing", async () => {
    const r = await call(financialsGET, "", { id: "U72900TN2017PTC999103" });
    const years = r.body.data.analysis.years;
    const fy24 = years.find((y: { financialYear: string }) => y.financialYear === "2024-25");
    expect(fy24.metrics.revenue.basis).toBe("reported");
    expect(fy24.metrics.ebitda).toEqual({ value: null, basis: null });
    const fy23 = years.find((y: { financialYear: string }) => y.financialYear === "2023-24");
    expect(fy23.metrics.ebitda.basis).toBe("calculated");
    expect(fy23.metrics.totalLiabilities.basis).toBe("calculated");
    expect(r.body.data.analysis.cagr.find((c: { metric: string; span: number }) => c.metric === "revenue" && c.span === 3).value).toBeGreaterThan(0);
  });

  it("charges: open vs satisfied summary", async () => {
    const r = await call(chargesGET, "", { id: "U45200DL2009PTC999105" });
    expect(r.body.data.summary).toMatchObject({ open: 4, satisfied: 1, openAmount: 405e7 });
  });

  it("network: company → director → other companies/LLPs with common directors", async () => {
    const r = await call(networkGET, `/api/companies/${AAROHAN}/network?depth=2`, { id: AAROHAN });
    const g = r.body.data;
    expect(g.nodes.find((n: { isRoot?: boolean }) => n.isRoot).identifier).toBe(AAROHAN);
    expect(g.nodes.some((n: { type: string }) => n.type === "llp")).toBe(true);
    const cedar = g.commonDirectors.find((c: { entityIdentifier: string }) => c.entityIdentifier === "U72900TN2017PTC999103");
    expect(cedar.sharedDirectors.map((d: { name: string }) => d.name).sort()).toEqual(["Meera Iyer", "Priya Raghavan"]);
  });

  it("director lookup by DIN lists current & previous companies and co-directors", async () => {
    const r = await call(directorGET, "", { din: "99900104" });
    expect(r.body.data.name).toBe("Vikram Sethi");
    expect(r.body.data.roles.map((x: { entityIdentifier: string }) => x.entityIdentifier)).toEqual(expect.arrayContaining([BRIGHTWAVE, DECCAN, "U45200DL2009PTC999105"]));
    expect((await call(directorGET, "", { din: "12" })).status).toBe(400);
  });
});

describe("report & export", () => {
  it("generates a 12-section report where every citation resolves to a record", async () => {
    const r = await call(reportGET, "", { id: BRIGHTWAVE });
    const rep = r.body.data;
    expect(rep.sections).toHaveLength(12);
    expect(rep.generator).toBe("rule_based");
    for (const s of rep.sections)
      for (const p of s.paragraphs) {
        expect(p.citations.length).toBeGreaterThan(0);
        for (const c of p.citations) expect(rep.references[c]).toBeDefined();
      }
    // same data snapshot → same stored report; share token resolves
    const again = await call(reportGET, "", { id: BRIGHTWAVE });
    expect(again.body.data.id).toBe(rep.id);
    const shared = await call(sharedGET, "", { token: rep.shareToken });
    expect(shared.body.data.id).toBe(rep.id);
    expect((await call(sharedGET, "", { token: "nope" })).status).toBe(404);
  });

  it("exports CSV sections and a PDF", async () => {
    const csv = await call(exportGET, `/api/companies/${AAROHAN}/export?format=csv&section=financials`, { id: AAROHAN });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-disposition")).toContain(`${AAROHAN}-financials.csv`);
    expect(String(csv.body)).toContain("financial_year,metric,value_inr,basis");
    const pdf = await call(exportGET, `/api/companies/${AAROHAN}/export?format=pdf`, { id: AAROHAN });
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(new TextDecoder().decode((pdf.body as Uint8Array).slice(0, 5))).toBe("%PDF-");
    expect((await call(exportGET, `/api/companies/${AAROHAN}/export?format=csv&section=bogus`, { id: AAROHAN })).status).toBe(400);
  });
});

describe("meta", () => {
  it("reports data mode, provider capabilities and sync logs", async () => {
    const r = await call(sourcesGET, "/api/meta/sources");
    expect(r.body.meta.dataMode).toBe("demo");
    expect(r.body.data.counts.companies).toBeGreaterThanOrEqual(8);
    const ogd = r.body.data.providers.find((p: { id: string }) => p.id === "ogd_datagov");
    expect(ogd.capabilities).toMatchObject({ masterData: true, directors: false, filings: false });
    expect(r.body.data.syncLogs.some((l: { jobType: string }) => l.jobType === "demo_seed")).toBe(true);
  });
});
