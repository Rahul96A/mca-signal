import { describe, expect, it } from "vitest";
import { computeSignals } from "@/lib/analysis/risk";
import { estimateDueDate } from "@/lib/domain/forms";
import type { Charge, DirectorRole, EntityProfile, Filing, Provenance } from "@/lib/domain/types";

const prov: Provenance = { sourceId: "demo", sourceName: "Demo", sourceCategory: "demo", sourceRecordId: null, fetchedAt: null, publishedAt: null, lastUpdatedAt: null, rawResponseHash: null };
const NOW = new Date("2026-09-23T00:00:00Z");

function profile(over: Partial<EntityProfile> = {}): EntityProfile {
  return {
    id: "p", kind: "company", identifier: "U01403KA2014PTC999101", name: "TEST PRIVATE LIMITED", status: "Active", companyClass: "Private", category: null, subCategory: null,
    listingStatus: null, origin: null, incorporationDate: "2014-06-12", ageYears: 12, roc: null, state: null, nicCode: null, industry: null, principalActivity: null,
    authorizedCapital: null, paidUpCapital: null, totalContribution: null, email: null, lastAgmDate: null, lastBalanceSheetDate: null, registeredOffice: null,
    addressHistory: [], nameHistory: [], provenance: prov, ...over,
  };
}
const filing = (formType: string, fy: string | null, filingDate: string, delayDays = 0, dueDate: string | null = null): Filing => ({
  id: `${formType}-${fy}-${filingDate}`, formType, formDescription: null, financialYear: fy, filingDate, dueDate, dueDateBasis: dueDate ? "provided" : null, eventDate: null,
  status: "Filed", srn: null, documentAvailable: true, documentUrl: null, delayDays, provenance: prov,
});
const allAnnual = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i).flatMap((y) => {
    const fy = `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
    return [filing("AOC-4", fy, `${y + 1}-10-20`), filing("MGT-7", fy, `${y + 1}-11-20`)];
  });

const BANNED = /fraud|scam|illegal|shell company|money laundering|criminal/i;

describe("computeSignals", () => {
  it("flags non-active status with attention and neutral wording", () => {
    const s = computeSignals({ profile: profile({ status: "Strike Off" }), directors: [], filings: [], financials: null, charges: [], related: [], now: NOW });
    const st = s.find((x) => x.id === "status-inactive")!;
    expect(st.severity).toBe("attention");
    expect(st.detail).toMatch(/Potential review item/);
    expect(st.evidence[0].ref).toBe("profile:status");
  });

  it("reports delayed filings with evidence and the neutral phrase", () => {
    const f = [...allAnnual(2020, 2024)];
    f[0] = filing("AOC-4", "2020-21", "2022-01-28", 90, "2021-10-30");
    const s = computeSignals({ profile: profile(), directors: [], filings: f, financials: null, charges: [], related: [], now: new Date("2026-01-01T00:00:00Z") });
    const d = s.find((x) => x.id === "filings-delayed")!;
    expect(d.title).toMatch(/appear delayed based on available dates/);
    expect(d.evidence.map((e) => e.type)).toEqual(["filing"]);
  });

  it("detects missing annual filings only for years whose due date has passed", () => {
    const f = allAnnual(2020, 2023); // FY 2024-25 missing, due Oct/Nov 2025 → past on NOW
    const s = computeSignals({ profile: profile(), directors: [], filings: f, financials: null, charges: [], related: [], now: NOW });
    const m = s.find((x) => x.id === "filings-missing")!;
    expect(m.detail).toContain("AOC-4 FY 2024-25");
    expect(m.detail).toContain("MGT-7 FY 2024-25");
    expect(m.detail).toMatch(/Data point requiring further verification/);
    // FY 2025-26 isn't due until Oct 2026 → must not be flagged
    expect(m.detail).not.toContain("2025-26");
  });

  it("does not run missing-filing checks when filings are unavailable from sources", () => {
    const s = computeSignals({ profile: profile(), directors: null, filings: null, financials: null, charges: null, related: [], now: NOW });
    expect(s.some((x) => x.id === "filings-missing")).toBe(false);
    expect(s.some((x) => x.id === "filings-unavailable")).toBe(true);
    expect(s.some((x) => x.id === "directors-unavailable")).toBe(true);
  });

  it("flags frequent director changes", () => {
    const role = (name: string, a: string, c: string | null): DirectorRole => ({ id: name, directorId: name, din: "99900199", name, designation: "Director", appointmentDate: a, cessationDate: c, isCurrent: !c, provenance: prov });
    const dirs = [role("A", "2014-06-12", null), role("B", "2023-01-10", "2024-06-30"), role("C", "2024-07-01", null), role("D", "2024-11-20", null)];
    const s = computeSignals({ profile: profile(), directors: dirs, filings: allAnnual(2020, 2024), financials: null, charges: [], related: [], now: NOW });
    expect(s.find((x) => x.id === "directors-frequent")?.severity).toBe("review");
  });

  it("summarises open charges and flags inactive related entities without accusation", () => {
    const ch: Charge[] = [{ id: "c1", chargeId: "1", holderName: "Bank", amount: 5e7, creationDate: "2019-01-01", modificationDate: null, satisfactionDate: null, status: "open", propertyDescription: null, provenance: prov }];
    const s = computeSignals({
      profile: profile(), directors: [], filings: allAnnual(2020, 2024), financials: null, charges: ch, now: NOW,
      related: [{ identifier: "X", name: "OLD CO", kind: "company", status: "Strike Off", viaDin: "1", viaName: "Someone" }],
    });
    expect(s.find((x) => x.id === "charges-open")?.title).toMatch(/1 open charge/);
    const n = s.find((x) => x.id === "network-inactive-related")!;
    expect(n.detail).toMatch(/does not imply any issue/);
    for (const sig of s) expect(`${sig.title} ${sig.detail}`).not.toMatch(BANNED);
  });
});

describe("statutory due-date estimates", () => {
  it("follows Companies Act / LLP Act timelines", () => {
    expect(estimateDueDate("AOC-4", "2023-24")).toBe("2024-10-30");
    expect(estimateDueDate("AOC-4", "2023-24", { isOpc: true })).toBe("2024-09-27");
    expect(estimateDueDate("MGT-7A", "2023-24")).toBe("2024-11-29");
    expect(estimateDueDate("LLP Form 11", "2023-24")).toBe("2024-05-30");
    expect(estimateDueDate("DIR-12", "2023-24")).toBeNull();
  });
});
