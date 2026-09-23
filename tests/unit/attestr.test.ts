import { describe, expect, it } from "vitest";
import { ddmmyyyy, mapAttestrMaster, normalizeFormType, type AttestrMaster } from "@/lib/providers/attestr";
import { computeSignals } from "@/lib/analysis/risk";
import type { EntityProfile, Filing, Provenance } from "@/lib/domain/types";

// Shape follows the documented v2 response of POST /api/v2/public/corpx/business/master; values are fictional.
const FIXTURE: AttestrMaster = {
  valid: true,
  reg: "U72900KA2015PTC999555",
  businessName: "EXAMPLE ANALYTICS PRIVATE LIMITED",
  rocCode: "ROC Bangalore",
  category: "Company limited by shares",
  subCategory: "Non-government company",
  class: "Private",
  authorizedCapital: "1000000",
  paidCapital: "500000",
  incorporatedDate: "04-05-2015",
  email: "cs@example.test",
  listed: false,
  lastAGMDate: "27-09-2025",
  lastBSDate: "31-03-2025",
  status: "Active",
  previousName: "Example Data Private Limited",
  industryDivision: "Computer programming, consultancy and related activities",
  industrySection: "INFORMATION AND COMMUNICATION",
  addresses: [
    { type: "Registered Address", city: "BENGALURU", state: "Karnataka", zip: "560001", active: true, fullAddress: "1 MG ROAD, BENGALURU, Karnataka, India, 560001" },
    { type: "Registered Address", city: "MYSURU", state: "Karnataka", zip: "570001", active: false, fullAddress: "OLD OFFICE, MYSURU, Karnataka, India, 570001" },
    { type: "Annual Return Address", city: "BENGALURU", state: "Karnataka", active: true, fullAddress: "AR ADDRESS" },
  ],
  directorsAndSignatories: [
    { din: "99955501", firstName: "ASHA", middleName: null, lastName: "RAO", appointmentDate: "04-05-2015", role: "Director/Designated Partner", designation: "Managing Director", roleCessationDate: null, isCurrentSignatory: true, type: "Signatory" },
    { din: "99955502", firstName: "VIVEK", lastName: "NAIR", appointmentDate: "01-04-2018", designation: "Director", roleCessationDate: "30-06-2024", isCurrentSignatory: false, type: "Signatory" },
    // filing-portal user row duplicating a director — must be ignored
    { din: "99955501", firstName: "ASHA", lastName: "RAO", appointmentDate: "11-07-2023", designation: null, isCurrentSignatory: false, type: "FO User" },
  ],
  charges: [
    { chargeId: "100999001", chargeHolder: "EXAMPLE BANK LIMITED", amount: "25000000.00", createdDate: "10-01-2020", modifiedDate: "15-02-2022", satisfiedDate: null, chargeStatus: "Open" },
    { chargeId: "100999002", chargeHolder: "EXAMPLE FINANCE LIMITED", amount: "5000000.00", createdDate: "01-06-2016", satisfiedDate: "30-11-2019", chargeStatus: "Closed" },
  ],
  efilings: [
    { srn: "Z00000001", eform: "Form AOC-4(XBRL)", filed: "25-10-2025" },
    { srn: "Z00000002", eform: "MGT-7A", filed: "20-11-2025" },
    { srn: "Z00000003", eform: "Form DIR-12", filed: "10-07-2024" },
  ],
  updated: 1782021074236,
};

describe("Attestr mapping", () => {
  const b = mapAttestrMaster(FIXTURE, "U72900KA2015PTC999555", "third_party_mca")!;

  it("maps master data with DD-MM-YYYY dates converted", () => {
    expect(b.entity).toMatchObject({
      kind: "company",
      identifier: "U72900KA2015PTC999555",
      status: "Active",
      incorporationDate: "2015-05-04",
      authorizedCapital: 1_000_000,
      paidUpCapital: 500_000,
      listingStatus: "Unlisted",
      lastAgmDate: "2025-09-27",
      industry: "Information And Communication",
      state: "Karnataka",
    });
    expect(b.nameHistory).toEqual([{ previousName: "EXAMPLE DATA PRIVATE LIMITED", changedOn: null }]);
  });

  it("keeps only the current registered office (past ones have no dates)", () => {
    expect(b.addresses).toHaveLength(1);
    expect(b.addresses![0]).toMatchObject({ pincode: "560001", city: "BENGALURU" });
  });

  it("maps directors, skips filing-portal user rows, and never carries PAN", () => {
    expect(b.directors).toEqual([
      { din: "99955501", name: "Asha Rao", designation: "Managing Director", appointmentDate: "2015-05-04", cessationDate: null },
      { din: "99955502", name: "Vivek Nair", designation: "Director", appointmentDate: "2018-04-01", cessationDate: "2024-06-30" },
    ]);
    const json = JSON.stringify(b);
    expect(json).not.toMatch(/"pan"/i);
    expect(json).not.toMatch(/[A-Z]{5}\d{4}[A-Z]/); // no PAN-shaped values
  });

  it("maps charges with open/satisfied status", () => {
    expect(b.charges).toEqual([
      { chargeId: "100999001", holderName: "EXAMPLE BANK LIMITED", amount: 25_000_000, creationDate: "2020-01-10", modificationDate: "2022-02-15", satisfactionDate: null, status: "open" },
      { chargeId: "100999002", holderName: "EXAMPLE FINANCE LIMITED", amount: 5_000_000, creationDate: "2016-06-01", modificationDate: null, satisfactionDate: "2019-11-30", status: "satisfied" },
    ]);
  });

  it("maps e-filings without inventing a financial year; no financials section", () => {
    expect(b.filings!.map((f) => [f.formType, f.filingDate, f.financialYear])).toEqual([
      ["AOC-4 XBRL", "2025-10-25", null],
      ["MGT-7A", "2025-11-20", null],
      ["DIR-12", "2024-07-10", null],
    ]);
    expect(b.financials).toBeUndefined();
  });

  it("returns null for invalid registration numbers", () => {
    expect(mapAttestrMaster({ valid: false, message: "Invalid" }, "X", "t")).toBeNull();
  });

  it("normalises form names and dates", () => {
    expect(normalizeFormType("Form MGT-7")).toBe("MGT-7");
    expect(normalizeFormType("CHG1")).toBe("CHG-1");
    expect(normalizeFormType("Form 11")).toBe("LLP Form 11");
    expect(normalizeFormType("Form XYZ-9")).toBe("XYZ-9");
    expect(ddmmyyyy("31-03-2025")).toBe("2025-03-31");
    expect(ddmmyyyy("2025-03-31")).toBeNull();
  });
});

describe("risk engine with filings that lack a financial year", () => {
  it("skips the missing-annual-filing check instead of guessing", () => {
    const prov: Provenance = { sourceId: "third_party_mca", sourceName: "Attestr", sourceCategory: "third_party", sourceRecordId: null, fetchedAt: null, publishedAt: null, lastUpdatedAt: null, rawResponseHash: null };
    const profile = { id: "p", kind: "company", identifier: "U72900KA2015PTC999555", name: "X", status: "Active", companyClass: "Private", incorporationDate: "2015-05-04", addressHistory: [], nameHistory: [], provenance: prov } as unknown as EntityProfile;
    const filing: Filing = { id: "f1", formType: "AOC-4", formDescription: null, financialYear: null, filingDate: "2025-10-25", dueDate: null, dueDateBasis: null, eventDate: null, status: "Filed", srn: null, documentAvailable: true, documentUrl: null, delayDays: null, provenance: prov };
    const s = computeSignals({ profile, directors: [], filings: [filing], financials: null, charges: [], related: [], now: new Date("2026-09-23T00:00:00Z") });
    expect(s.some((x) => x.id === "filings-missing")).toBe(false);
    expect(s.some((x) => x.id === "filings-fy-unavailable")).toBe(true);
  });
});
