import { describe, expect, it } from "vitest";
import { fyFromPeriodEnd, mapP42Charges, mapP42Financials, mapP42Response, type P42Response } from "@/lib/providers/probe42";
import { analyzeFinancials, buildFinancialRecords } from "@/lib/analysis/financials";
import type { Provenance } from "@/lib/domain/types";

// Shape follows a recorded Probe42 v1.3 comprehensive-details response; all values are fictional.
const FIXTURE: P42Response = {
  metadata: { last_updated: "2026-06-04" },
  data: {
    company: {
      cin: "U72900KA2015PTC999777",
      legal_name: "EXAMPLE SOFTWORKS PRIVATE LIMITED",
      pan: "AAAAA0000A",
      status: "Unlisted",
      classification: "Private Limited Indian Non-Government Company",
      efiling_status: "Active",
      incorporation_date: "2015-06-01",
      paid_up_capital: 5000000,
      authorized_capital: 10000000,
      last_agm_date: "2025-09-20",
      last_filing_date: "2025-03-31",
      email: "cs@example.test",
      registered_address: { full_address: "12 Example Road,  Bengaluru - 560001", city: "Bengaluru", state: "Karnataka", pincode: "560001" },
    },
    name_history: [{ name: "Example Labs Private Limited", date: "2018-02-01" }],
    authorized_signatories: [
      { din: "99977701", name: "RITA SEN", designation: "Director", din_status: "Approved", date_of_appointment: "2015-06-01", date_of_cessation: null, nationality: "India" },
      { din: "99977702", name: "ARUN PILLAI", designation: "Director", din_status: "Approved", date_of_appointment: "2016-04-01", date_of_cessation: "2023-03-31" },
    ],
    charge_sequence: [
      { charge_id: 100777001, status: "Creation", date: "2019-05-10", amount: 20000000, holder_name: "EXAMPLE BANK LIMITED", property_type: "Book debts" },
      { charge_id: 100777001, status: "Modification", date: "2022-08-01", amount: 35000000, holder_name: "EXAMPLE BANK LIMITED" },
      { charge_id: 100777002, status: "Creation", date: "2016-01-15", amount: 5000000, holder_name: "EXAMPLE NBFC LIMITED" },
      { charge_id: 100777002, status: "Satisfaction", date: "2020-12-31", amount: 5000000, holder_name: "EXAMPLE NBFC LIMITED" },
    ],
    open_charges: [
      { id: 100777001, date: "2022-08-01", holder_name: "EXAMPLE BANK LIMITED", amount: 35000000, type: "Modification" },
      { id: 100777003, date: "2025-01-20", holder_name: "EXAMPLE CAPITAL LIMITED", amount: 8000000, type: "Creation" },
    ],
    financials: [
      {
        year: "2025-03-31",
        nature: "STANDALONE",
        stated_on: "2025-03-31",
        bs: { assets: { given_assets_total: 900000000 }, liabilities: { share_capital: 5000000 }, subTotals: { total_equity: 400000000, total_debt: 150000000 } },
        pnl: { lineItems: { net_revenue: 1200000000, other_income: 20000000, depreciation: 30000000, interest: 15000000, profit_before_tax: 180000000, profit_after_tax: 135000000 } },
      },
      {
        year: "2024-03-31",
        nature: "STANDALONE",
        bs: { assets: { given_assets_total: 780000000 }, liabilities: { share_capital: 5000000, long_term_borrowings: 100000000, short_term_borrowings: 60000000 }, subTotals: { total_equity: 265000000 } },
        pnl: { lineItems: { net_revenue: 1000000000, other_income: 15000000, depreciation: null, interest: 12000000, profit_before_tax: 140000000, profit_after_tax: 105000000 } },
      },
      // consolidated statements must not be mixed into the standalone series
      { year: "2025-03-31", nature: "CONSOLIDATED", pnl: { lineItems: { net_revenue: 9999999999 } } },
    ],
  },
};

describe("Probe42 mapping", () => {
  const b = mapP42Response(FIXTURE, "U72900KA2015PTC999777", "third_party_mca")!;

  it("maps master data and name history", () => {
    expect(b.entity).toMatchObject({
      kind: "company",
      identifier: "U72900KA2015PTC999777",
      name: "EXAMPLE SOFTWORKS PRIVATE LIMITED",
      status: "Active",
      companyClass: "Private",
      subCategory: "Non-government company",
      listingStatus: "Unlisted",
      incorporationDate: "2015-06-01",
      paidUpCapital: 5_000_000,
      lastUpdatedAt: "2026-06-04",
    });
    expect(b.nameHistory).toEqual([{ previousName: "EXAMPLE LABS PRIVATE LIMITED", changedOn: "2018-02-01" }]);
    expect(b.addresses![0]).toMatchObject({ line: "12 Example Road, Bengaluru - 560001", pincode: "560001" });
  });

  it("maps directors without personal data", () => {
    expect(b.directors).toEqual([
      { din: "99977701", name: "Rita Sen", nationality: "India", dinStatus: "Approved", designation: "Director", appointmentDate: "2015-06-01", cessationDate: null },
      { din: "99977702", name: "Arun Pillai", nationality: null, dinStatus: "Approved", designation: "Director", appointmentDate: "2016-04-01", cessationDate: "2023-03-31" },
    ]);
    expect(JSON.stringify(b)).not.toContain("AAAAA0000A");
  });

  it("collapses charge events into one row per charge and adds open charges without history", () => {
    expect(mapP42Charges(FIXTURE.data)).toEqual([
      { chargeId: "100777002", holderName: "EXAMPLE NBFC LIMITED", amount: 5_000_000, creationDate: "2016-01-15", modificationDate: null, satisfactionDate: "2020-12-31", status: "satisfied", propertyDescription: null },
      { chargeId: "100777001", holderName: "EXAMPLE BANK LIMITED", amount: 35_000_000, creationDate: "2019-05-10", modificationDate: "2022-08-01", satisfactionDate: null, status: "open", propertyDescription: "Book debts" },
      { chargeId: "100777003", holderName: "EXAMPLE CAPITAL LIMITED", amount: 8_000_000, creationDate: "2025-01-20", modificationDate: null, satisfactionDate: null, status: "open" },
    ]);
  });

  it("maps standalone financials only, by financial year, without inventing values", () => {
    const f = mapP42Financials(FIXTURE.data!.financials);
    expect(f.map((x) => x.financialYear)).toEqual(["2023-24", "2024-25"]);
    expect(f[1]).toMatchObject({ periodEnd: "2025-03-31", revenue: 1_200_000_000, profitAfterTax: 135_000_000, netWorth: 400_000_000, totalAssets: 900_000_000, borrowings: 150_000_000, paidUpCapital: 5_000_000 });
    expect(f[0].borrowings).toBe(160_000_000); // long + short term when total_debt is absent
    expect(f[0].depreciation).toBeNull();
    expect(f[1].totalLiabilities).toBeUndefined(); // left for the app to calculate & label
    expect(f[1].ebitda).toBeUndefined();
  });

  it("feeds the analysis engine with reported vs calculated labels and YoY", () => {
    const prov: Provenance = { sourceId: "third_party_mca", sourceName: "Probe42", sourceCategory: "third_party", sourceRecordId: null, fetchedAt: null, publishedAt: null, lastUpdatedAt: null, rawResponseHash: null };
    const rows = mapP42Financials(FIXTURE.data!.financials).map((f, i) => ({
      id: String(i),
      financial_year: f.financialYear,
      period_end: f.periodEnd,
      filing_id: null,
      provenance: prov,
      revenue: f.revenue,
      other_income: f.otherIncome,
      depreciation: f.depreciation,
      finance_cost: f.financeCost,
      profit_before_tax: f.profitBeforeTax,
      profit_after_tax: f.profitAfterTax,
      net_worth: f.netWorth,
      total_assets: f.totalAssets,
      borrowings: f.borrowings,
      paid_up_capital: f.paidUpCapital,
    }));
    const a = analyzeFinancials(buildFinancialRecords(rows));
    expect(a.latest!.metrics.revenue).toEqual({ value: 1_200_000_000, basis: "reported" });
    expect(a.latest!.metrics.ebitda).toMatchObject({ value: 225_000_000, basis: "calculated" });
    expect(a.latest!.metrics.totalLiabilities).toMatchObject({ value: 500_000_000, basis: "calculated" });
    expect(a.years[0].metrics.ebitda).toEqual({ value: null, basis: null }); // depreciation not reported
    expect(a.yoy["2024-25"].revenue).toBeCloseTo(0.2);
  });

  it("derives FY labels from period ends and rejects empty payloads", () => {
    expect(fyFromPeriodEnd("2025-03-31")).toBe("2024-25");
    expect(fyFromPeriodEnd("2024-12-31")).toBe("2024-25");
    expect(mapP42Response({ data: {} }, "U1", "x")).toBeNull();
  });
});
