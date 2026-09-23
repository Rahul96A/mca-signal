import { describe, expect, it } from "vitest";
import { analyzeFinancials, buildFinancialRecords, cagr, growth } from "@/lib/analysis/financials";
import type { Provenance } from "@/lib/domain/types";

const prov: Provenance = { sourceId: "demo", sourceName: "Demo", sourceCategory: "demo", sourceRecordId: null, fetchedAt: null, publishedAt: null, lastUpdatedAt: null, rawResponseHash: null };
const row = (fy: string, v: Record<string, number | null>) => ({ id: fy, financial_year: fy, period_end: null, filing_id: null, provenance: prov, ...v });

describe("buildFinancialRecords", () => {
  it("labels reported values and calculates EBITDA / liabilities only from same-year reported inputs", () => {
    const [r] = buildFinancialRecords([row("2023-24", { revenue: 1000, other_income: 50, profit_before_tax: 100, finance_cost: 20, depreciation: 30, net_worth: 400, total_assets: 900 })]);
    expect(r.metrics.revenue).toEqual({ value: 1000, basis: "reported" });
    expect(r.metrics.ebitda).toMatchObject({ value: 150, basis: "calculated" });
    expect(r.metrics.totalLiabilities).toMatchObject({ value: 500, basis: "calculated", formula: "Total assets − Net worth" });
    expect(r.metrics.totalIncome).toMatchObject({ value: 1050, basis: "calculated" });
  });

  it("never fabricates values when inputs are missing", () => {
    const [r] = buildFinancialRecords([row("2023-24", { revenue: 1000, profit_before_tax: 100, finance_cost: 20, depreciation: null })]);
    expect(r.metrics.ebitda).toEqual({ value: null, basis: null });
    expect(r.metrics.totalLiabilities).toEqual({ value: null, basis: null });
    expect(r.metrics.borrowings).toEqual({ value: null, basis: null });
  });

  it("prefers a reported EBITDA over calculation", () => {
    const [r] = buildFinancialRecords([row("2023-24", { ebitda: 999, profit_before_tax: 100, finance_cost: 20, depreciation: 30 })]);
    expect(r.metrics.ebitda).toEqual({ value: 999, basis: "reported" });
  });
});

describe("growth metrics", () => {
  it("computes YoY only for consecutive years with non-zero base", () => {
    expect(growth(100, 120)).toBeCloseTo(0.2);
    expect(growth(-100, -50)).toBeCloseTo(0.5);
    expect(growth(0, 50)).toBeNull();
    expect(growth(null, 50)).toBeNull();
  });

  it("returns CAGR only when both endpoints are positive", () => {
    expect(cagr(100, 200, 3)).toBeCloseTo(0.2599, 3);
    expect(cagr(-10, 200, 3)).toBeNull();
    expect(cagr(100, 0, 3)).toBeNull();
  });

  it("analyzes a multi-year series with YoY, ratios, and CAGR notes", () => {
    const rows = ["2020-21", "2021-22", "2022-23", "2023-24"].map((fy, i) => row(fy, { revenue: 100 * (i + 1), profit_after_tax: 10 * (i + 1), net_worth: 50, borrowings: 25 }));
    const a = analyzeFinancials(buildFinancialRecords(rows));
    expect(a.latest?.financialYear).toBe("2023-24");
    expect(a.yoy["2021-22"].revenue).toBeCloseTo(1);
    expect(a.yoy["2020-21"].revenue).toBeNull();
    expect(a.ratios["2023-24"].debtToEquity).toBeCloseTo(0.5);
    const c3 = a.cagr.find((c) => c.metric === "revenue" && c.span === 3)!;
    expect(c3.value).toBeCloseTo(4 ** (1 / 3) - 1);
    const c5 = a.cagr.find((c) => c.metric === "revenue" && c.span === 5)!;
    expect(c5.value).toBeNull();
    expect(c5.note).toMatch(/Needs 6 years/);
  });
});
