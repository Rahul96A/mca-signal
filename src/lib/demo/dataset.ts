/**
 * FICTIONAL demo dataset. Every company, LLP, person, lender and number below is invented for
 * demonstration. Identifiers use ranges that are not allotted by the MCA (CIN registration
 * numbers 999xxx, DINs 9990xxxx, LLPINs ZZA-xxxx) so they cannot collide with real entities.
 */
import { describeForm, estimateDueDate, fyLabel } from "../domain/forms";
import type { ProviderEntityBundle, RawCharge, RawDirectorRole, RawFiling, RawFinancial } from "../providers/types";

export const DEMO_SOURCE_ID = "demo";
const L = 100_000; // 1 lakh INR

const P = {
  priya: { din: "99900101", name: "Priya Raghavan" },
  arjun: { din: "99900102", name: "Arjun Malhotra" },
  meera: { din: "99900103", name: "Meera Iyer" },
  vikram: { din: "99900104", name: "Vikram Sethi" },
  kavita: { din: "99900105", name: "Kavita Deshpande" },
  sameer: { din: "99900106", name: "Sameer Qureshi" },
  ananya: { din: "99900107", name: "Ananya Bose" },
  nikhil: { din: "99900108", name: "Nikhil Venkatesh" },
  farhan: { din: "99900109", name: "Farhan Sheikh" },
  lakshmi: { din: "99900110", name: "Lakshmi Narayanan" },
  deepak: { din: "99900111", name: "Deepak Choudhary" },
  harpreet: { din: "99900112", name: "Harpreet Gill" },
  tanvi: { din: "99900113", name: "Tanvi Kulkarni" },
  joseph: { din: "99900114", name: "Joseph Mathew" },
  suresh: { din: "99900115", name: "Suresh Agarwal" },
  nisha: { din: "99900116", name: "Nisha Agarwal" },
  rakesh: { din: "99900117", name: "Rakesh Patel" },
  anil: { din: "99900118", name: "Anil Thomas" },
};

function role(p: { din: string; name: string }, designation: string, appointmentDate: string, cessationDate: string | null = null): RawDirectorRole {
  return { din: p.din, name: p.name, nationality: "Indian", dinStatus: "Approved", designation, appointmentDate, cessationDate };
}

let srnCounter = 1000;
function filing(formType: string, filingDate: string | null, extra: Partial<RawFiling> = {}): RawFiling {
  srnCounter += 1;
  return {
    formType,
    formDescription: describeForm(formType),
    filingDate,
    status: filingDate ? "Filed" : "Not filed",
    srn: filingDate ? `DEMO${srnCounter}` : null,
    documentAvailable: Boolean(filingDate),
    documentUrl: null,
    ...extra,
  };
}

/** Add days to an ISO date. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Recurring annual filings for FY startYear..endYear.
 * `late` maps "FY:FORM" → days after due date the form was filed; `missing` lists "FY:FORM" never filed.
 */
function annualFilings(opts: {
  from: number;
  to: number;
  forms: string[];
  isOpc?: boolean;
  late?: Record<string, number>;
  missing?: string[];
}): RawFiling[] {
  const out: RawFiling[] = [];
  for (let y = opts.from; y <= opts.to; y++) {
    const fy = fyLabel(y);
    opts.forms.forEach((form, i) => {
      const key = `${fy}:${form}`;
      const due = estimateDueDate(form, fy, { isOpc: opts.isOpc })!;
      // Missing filings are simply absent — the analysis layer detects the gap.
      if (opts.missing?.includes(key)) return;
      const late = opts.late?.[key];
      const filed = late !== undefined ? addDays(due, late) : addDays(due, -((y * 7 + i * 5) % 18) - 2);
      out.push(filing(form, filed, { financialYear: fy, dueDate: due, eventDate: `${y + 1}-03-31` }));
    });
  }
  return out;
}

type Row = [number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null];
/** Rows in INR lakhs: [revenue, otherIncome, depreciation, financeCost, PBT, PAT, netWorth, totalAssets, borrowings, paidUpCapital] */
function financials(startYear: number, rows: Row[]): RawFinancial[] {
  const m = (v: number | null) => (v === null ? null : Math.round(v * L));
  return rows.map((r, i) => {
    const y = startYear + i;
    return {
      financialYear: fyLabel(y),
      periodEnd: `${y + 1}-03-31`,
      revenue: m(r[0]),
      otherIncome: m(r[1]),
      totalIncome: r[0] !== null && r[1] !== null ? m(r[0] + r[1]) : null,
      depreciation: m(r[2]),
      financeCost: m(r[3]),
      profitBeforeTax: m(r[4]),
      profitAfterTax: m(r[5]),
      netWorth: m(r[6]),
      totalAssets: m(r[7]),
      borrowings: m(r[8]),
      paidUpCapital: m(r[9]),
    };
  });
}

function charge(chargeId: string, holderName: string, lakhs: number, creationDate: string, extra: Partial<RawCharge> = {}): RawCharge {
  return {
    chargeId,
    holderName,
    amount: lakhs * L,
    creationDate,
    status: extra.satisfactionDate ? "satisfied" : "open",
    ...extra,
  };
}

const demoMeta = { sourceRecordId: null, publishedAt: "2026-07-22", lastUpdatedAt: "2026-09-01" };

export const DEMO_BUNDLES: ProviderEntityBundle[] = [
  // ── A. Healthy, growing, secured borrowing ──────────────────────────────────
  {
    sourceId: DEMO_SOURCE_ID,
    rawResponseHash: "demo-aarohan-v1",
    entity: {
      kind: "company",
      identifier: "U01403KA2014PTC999101",
      name: "AAROHAN AGRITECH PRIVATE LIMITED",
      status: "Active",
      companyClass: "Private",
      category: "Company limited by shares",
      subCategory: "Non-government company",
      listingStatus: "Unlisted",
      origin: "Indian",
      incorporationDate: "2014-06-12",
      roc: "RoC-Bangalore",
      state: "Karnataka",
      nicCode: "01403",
      industry: "Agriculture & allied activities",
      principalActivity: "Support activities for crop production",
      authorizedCapital: 500 * L,
      paidUpCapital: 320 * L,
      email: "compliance@aarohan-agritech.example",
      lastAgmDate: "2025-09-24",
      lastBalanceSheetDate: "2025-03-31",
      ...demoMeta,
    },
    addresses: [{ line: "No. 42, 3rd Cross, HSR Layout Sector 6", city: "Bengaluru", state: "Karnataka", pincode: "560102", effectiveFrom: "2014-06-12" }],
    nameHistory: [{ previousName: "AAROHAN FARM SOLUTIONS PRIVATE LIMITED", changedOn: "2018-09-14" }],
    directors: [
      role(P.priya, "Managing Director", "2014-06-12"),
      role(P.arjun, "Director", "2014-06-12"),
      role(P.sameer, "Director", "2016-04-01", "2021-07-31"),
      role(P.meera, "Director", "2021-08-01"),
    ],
    filings: [
      ...annualFilings({ from: 2019, to: 2024, forms: ["AOC-4", "MGT-7"] }),
      filing("DIR-12", "2016-04-18", { eventDate: "2016-04-01" }),
      filing("CHG-1", "2017-05-15", { eventDate: "2017-05-02" }),
      filing("INC-24", "2018-09-20", { eventDate: "2018-09-14" }),
      filing("CHG-1", "2019-03-28", { eventDate: "2019-03-14" }),
      filing("ADT-1", "2019-10-10", { eventDate: "2019-09-27" }),
      filing("DIR-12", "2021-08-10", { eventDate: "2021-08-01" }),
      filing("CHG-4", "2022-01-05", { eventDate: "2021-12-20" }),
      filing("SH-7", "2022-06-20", { eventDate: "2022-06-02" }),
      filing("MGT-14", "2022-07-05", { eventDate: "2022-06-02" }),
      filing("PAS-3", "2022-07-22", { eventDate: "2022-07-10" }),
      filing("CHG-1", "2022-11-24", { eventDate: "2022-11-10" }),
      filing("CHG-1", "2024-03-02", { eventDate: "2024-02-19" }),
      filing("ADT-1", "2024-10-08", { eventDate: "2024-09-26" }),
    ],
    financials: financials(2020, [
      [1850, 22, 60, 48, 142, 106, 1120, 2480, 640, 250],
      [2310, 18, 72, 55, 205, 153, 1273, 2890, 720, 250],
      [2960, 25, 85, 70, 268, 199, 1760, 3650, 980, 320],
      [3480, 31, 96, 88, 322, 241, 2001, 4120, 1150, 320],
      [4105, 36, 110, 97, 391, 292, 2293, 4710, 1320, 320],
    ]),
    charges: [
      charge("100245871", "Konark Finance Limited", 250, "2017-05-02", { satisfactionDate: "2021-12-20", propertyDescription: "Hypothecation of vehicles" }),
      charge("100312904", "Sahyadri Commercial Bank Limited", 1200, "2019-03-14", { modificationDate: "2022-11-10", propertyDescription: "Book debts, stock and receivables (working capital limits enhanced from ₹8 Cr)" }),
      charge("100688213", "Sahyadri Commercial Bank Limited", 400, "2024-02-19", { propertyDescription: "Hypothecation of processing equipment" }),
    ],
  },

  // ── B. Declining logistics company: losses, frequent director & office changes, late filings ──
  {
    sourceId: DEMO_SOURCE_ID,
    rawResponseHash: "demo-brightwave-v1",
    entity: {
      kind: "company",
      identifier: "U63090MH2011PTC999102",
      name: "BRIGHTWAVE LOGISTICS PRIVATE LIMITED",
      status: "Active",
      companyClass: "Private",
      category: "Company limited by shares",
      subCategory: "Non-government company",
      listingStatus: "Unlisted",
      origin: "Indian",
      incorporationDate: "2011-02-21",
      roc: "RoC-Mumbai",
      state: "Maharashtra",
      nicCode: "63090",
      industry: "Transport & logistics",
      principalActivity: "Other transportation support activities",
      authorizedCapital: 1000 * L,
      paidUpCapital: 600 * L,
      email: "cs@brightwave-logistics.example",
      lastAgmDate: "2025-12-30",
      lastBalanceSheetDate: "2024-03-31",
      ...demoMeta,
    },
    addresses: [
      { line: "Unit 12, Sai Industrial Estate, Andheri East", city: "Mumbai", state: "Maharashtra", pincode: "400093", effectiveFrom: "2011-02-21", effectiveTo: "2021-11-30" },
      { line: "Office 504, Horizon Tower, Sector 17, Vashi", city: "Navi Mumbai", state: "Maharashtra", pincode: "400703", effectiveFrom: "2021-12-01", effectiveTo: "2023-08-31" },
      { line: "Plot 18, MIDC Industrial Area, Taloja", city: "Navi Mumbai", state: "Maharashtra", pincode: "410208", effectiveFrom: "2023-09-01" },
    ],
    directors: [
      role(P.vikram, "Director", "2011-02-21"),
      role(P.kavita, "Director", "2011-02-21", "2022-03-15"),
      role(P.farhan, "Director", "2022-03-15", "2023-01-10"),
      role(P.tanvi, "Director", "2023-01-10", "2024-06-30"),
      role(P.deepak, "Director", "2024-07-01"),
      role(P.harpreet, "Additional Director", "2024-11-20"),
    ],
    filings: [
      ...annualFilings({
        from: 2019,
        to: 2024,
        forms: ["AOC-4", "MGT-7"],
        late: { "2021-22:AOC-4": 80, "2022-23:AOC-4": 113, "2022-23:MGT-7": 64, "2023-24:AOC-4": 59, "2023-24:MGT-7": 47, "2024-25:MGT-7": 52 },
        missing: ["2024-25:AOC-4"],
      }),
      filing("CHG-1", "2015-08-24", { eventDate: "2015-08-10" }),
      filing("CHG-1", "2016-03-14", { eventDate: "2016-03-01" }),
      filing("CHG-4", "2020-03-10", { eventDate: "2020-02-28" }),
      filing("CHG-1", "2021-07-01", { eventDate: "2021-06-18" }),
      filing("INC-22", "2021-12-14", { eventDate: "2021-12-01" }),
      filing("DIR-12", "2022-03-29", { eventDate: "2022-03-15" }),
      filing("CHG-1", "2022-09-19", { eventDate: "2022-09-05" }),
      filing("DIR-12", "2023-01-24", { eventDate: "2023-01-10" }),
      filing("INC-22", "2023-09-12", { eventDate: "2023-09-01" }),
      filing("CHG-1", "2023-12-26", { eventDate: "2023-12-12" }),
      filing("ADT-1", "2024-01-15", { eventDate: "2023-12-29" }),
      filing("DIR-12", "2024-07-12", { eventDate: "2024-07-01" }),
      filing("DIR-12", "2024-12-02", { eventDate: "2024-11-20" }),
    ],
    financials: financials(2020, [
      [5620, 40, 210, 380, 95, 70, 2150, 7800, 3900, 600],
      [5210, 35, 225, 410, -60, -60, 2090, 7650, 4100, 600],
      [4480, 28, 230, 455, -310, -310, 1780, 7420, 4450, 600],
      [3950, 20, 228, 490, -520, -520, 1260, 7050, 4700, 600],
    ]),
    charges: [
      charge("100158832", "Western Coast Bank Limited", 3500, "2015-08-10", { modificationDate: "2021-06-18", propertyDescription: "Fleet vehicles and receivables (limit enhanced from ₹25 Cr)" }),
      charge("100167301", "Konark Finance Limited", 300, "2016-03-01", { satisfactionDate: "2020-02-28", propertyDescription: "Hypothecation of trucks" }),
      charge("100590114", "Trident Capital Finance Limited", 900, "2022-09-05", { propertyDescription: "Term loan secured on warehouse equipment" }),
      charge("100677540", "Western Coast Bank Limited", 1200, "2023-12-12", { propertyDescription: "Additional working capital facility" }),
    ],
  },

  // ── C. Asset-light IT services, no charges ─────────────────────────────────
  {
    sourceId: DEMO_SOURCE_ID,
    rawResponseHash: "demo-cedarline-v1",
    entity: {
      kind: "company",
      identifier: "U72900TN2017PTC999103",
      name: "CEDARLINE SOFTWARE SOLUTIONS PRIVATE LIMITED",
      status: "Active",
      companyClass: "Private",
      category: "Company limited by shares",
      subCategory: "Non-government company",
      listingStatus: "Unlisted",
      origin: "Indian",
      incorporationDate: "2017-09-04",
      roc: "RoC-Chennai",
      state: "Tamil Nadu",
      nicCode: "72900",
      industry: "IT services",
      principalActivity: "Computer programming, consultancy and related activities",
      authorizedCapital: 100 * L,
      paidUpCapital: 50 * L,
      email: "info@cedarline.example",
      lastAgmDate: "2025-09-19",
      lastBalanceSheetDate: "2025-03-31",
      ...demoMeta,
    },
    addresses: [{ line: "5th Floor, Olympia Techpark Annexe, Guindy", city: "Chennai", state: "Tamil Nadu", pincode: "600032", effectiveFrom: "2017-09-04" }],
    directors: [role(P.meera, "Director", "2017-09-04"), role(P.joseph, "Director", "2017-09-04"), role(P.priya, "Director", "2020-01-15")],
    filings: [
      ...annualFilings({ from: 2019, to: 2019, forms: ["AOC-4", "MGT-7"] }),
      ...annualFilings({ from: 2020, to: 2024, forms: ["AOC-4", "MGT-7A"] }),
      filing("INC-20A", "2017-11-02", { eventDate: "2017-10-30" }),
      filing("ADT-1", "2017-10-03", { eventDate: "2017-09-30" }),
      filing("DIR-12", "2020-01-25", { eventDate: "2020-01-15" }),
      filing("ADT-1", "2022-10-11", { eventDate: "2022-09-28" }),
    ],
    financials: financials(2020, [
      [420, 8, 18, 0, 88, 66, 310, 520, 0, 50],
      [690, 12, 22, 0, 162, 121, 431, 760, 0, 50],
      [1040, 15, 30, 2, 248, 186, 617, 1080, 0, 50],
      [1380, 24, 38, 3, 318, 238, 855, 1420, 0, 50],
      [1720, 30, null, 3, 402, 301, 1156, 1810, 0, 50],
    ]),
    charges: [],
  },

  // ── D. Struck-off food company ─────────────────────────────────────────────
  {
    sourceId: DEMO_SOURCE_ID,
    rawResponseHash: "demo-deccan-v1",
    entity: {
      kind: "company",
      identifier: "U15400TG2012PTC999104",
      name: "DECCAN PURE FOODS PRIVATE LIMITED",
      status: "Strike Off",
      companyClass: "Private",
      category: "Company limited by shares",
      subCategory: "Non-government company",
      listingStatus: "Unlisted",
      origin: "Indian",
      incorporationDate: "2012-11-19",
      roc: "RoC-Hyderabad",
      state: "Telangana",
      nicCode: "15400",
      industry: "Food products",
      principalActivity: "Manufacture of other food products",
      authorizedCapital: 25 * L,
      paidUpCapital: 10 * L,
      email: null,
      lastAgmDate: "2019-09-28",
      lastBalanceSheetDate: "2019-03-31",
      ...demoMeta,
    },
    addresses: [{ line: "H.No. 8-2-293, Road No. 12, Banjara Hills", city: "Hyderabad", state: "Telangana", pincode: "500034", effectiveFrom: "2012-11-19" }],
    directors: [role(P.vikram, "Director", "2012-11-19"), role(P.lakshmi, "Director", "2012-11-19")],
    filings: [
      ...annualFilings({ from: 2017, to: 2018, forms: ["AOC-4", "MGT-7"] }),
      filing("STK-2", "2023-02-10", { eventDate: "2023-01-30" }),
    ],
    financials: financials(2018, [[42, 1, 2, 0, -3, -3, 6, 14, 0, 10]]),
    charges: [],
  },

  // ── E. Leveraged real-estate developer, capital infusion ──────────────────
  {
    sourceId: DEMO_SOURCE_ID,
    rawResponseHash: "demo-everstone-v1",
    entity: {
      kind: "company",
      identifier: "U45200DL2009PTC999105",
      name: "EVERSTONE REALTY DEVELOPERS PRIVATE LIMITED",
      status: "Active",
      companyClass: "Private",
      category: "Company limited by shares",
      subCategory: "Non-government company",
      listingStatus: "Unlisted",
      origin: "Indian",
      incorporationDate: "2009-05-07",
      roc: "RoC-Delhi",
      state: "Delhi",
      nicCode: "45200",
      industry: "Real estate & construction",
      principalActivity: "Construction and development of residential buildings",
      authorizedCapital: 5000 * L,
      paidUpCapital: 3200 * L,
      email: "secretarial@everstone-realty.example",
      lastAgmDate: "2025-09-29",
      lastBalanceSheetDate: "2025-03-31",
      ...demoMeta,
    },
    addresses: [{ line: "Tower B, 9th Floor, Connaught Place Commercial Complex", city: "New Delhi", state: "Delhi", pincode: "110001", effectiveFrom: "2009-05-07" }],
    nameHistory: [{ previousName: "EVERSTONE BUILDCON PRIVATE LIMITED", changedOn: "2013-03-22" }],
    directors: [
      role(P.suresh, "Managing Director", "2009-05-07"),
      role(P.nisha, "Director", "2009-05-07"),
      role(P.vikram, "Director", "2015-10-01"),
      role(P.arjun, "Director", "2019-04-01", "2023-03-31"),
    ],
    filings: [
      ...annualFilings({ from: 2019, to: 2024, forms: ["AOC-4", "MGT-7"], late: { "2022-23:AOC-4": 74 } }),
      filing("CHG-1", "2012-06-14", { eventDate: "2012-06-01" }),
      filing("INC-24", "2013-03-28", { eventDate: "2013-03-22" }),
      filing("CHG-1", "2016-02-24", { eventDate: "2016-02-11" }),
      filing("DIR-12", "2015-10-12", { eventDate: "2015-10-01" }),
      filing("DIR-12", "2019-04-10", { eventDate: "2019-04-01" }),
      filing("CHG-4", "2019-09-11", { eventDate: "2019-08-30" }),
      filing("CHG-1", "2019-09-30", { eventDate: "2019-09-17" }),
      filing("CHG-1", "2021-07-30", { eventDate: "2021-07-19" }),
      filing("DIR-12", "2023-04-12", { eventDate: "2023-03-31" }),
      filing("MGT-14", "2023-06-08", { eventDate: "2023-05-29" }),
      filing("SH-7", "2023-06-12", { eventDate: "2023-05-29" }),
      filing("PAS-3", "2023-07-03", { eventDate: "2023-06-21" }),
      filing("CHG-1", "2023-10-18", { eventDate: "2023-10-05" }),
      filing("ADT-1", "2024-10-14", { eventDate: "2024-09-30" }),
      filing("CHG-1", "2024-06-04", { eventDate: "2024-05-22" }),
    ],
    financials: financials(2020, [
      [8900, 120, 140, 1650, 410, 305, 9800, 48200, 26500, 1200],
      [11200, 150, 150, 1820, 780, 584, 10384, 52600, 29800, 1200],
      [13850, 160, 165, 2140, 1120, 838, 11222, 61400, 34200, 1200],
      [12400, 180, 170, 2610, 690, 516, 13738, 70800, 38900, 3200],
      [15100, 210, 185, 2950, 1340, 1003, 14741, 76500, 41200, 3200],
    ]),
    charges: [
      charge("100104420", "Konark Finance Limited", 3000, "2012-06-01", { satisfactionDate: "2019-08-30", propertyDescription: "Land parcel, Sector 70" }),
      charge("100221775", "Vardhan Housing Finance Limited", 15000, "2016-02-11", { propertyDescription: "Project receivables and land — Everstone Greens" }),
      charge("100401932", "Vardhan Housing Finance Limited", 5000, "2019-09-17", { modificationDate: "2024-05-22", propertyDescription: "Construction finance — Everstone Heights (tenure extended)" }),
      charge("100498861", "Western Coast Bank Limited", 12000, "2021-07-19", { propertyDescription: "Escrow of project receivables" }),
      charge("100662508", "Trident Capital Finance Limited", 8500, "2023-10-05", { propertyDescription: "Mortgage of unsold inventory" }),
    ],
  },

  // ── F. Venture-funded fintech: losses, repeated allotments ────────────────
  {
    sourceId: DEMO_SOURCE_ID,
    rawResponseHash: "demo-fintrail-v1",
    entity: {
      kind: "company",
      identifier: "U67190KA2019PTC999106",
      name: "FINTRAIL PAYMENTS PRIVATE LIMITED",
      status: "Active",
      companyClass: "Private",
      category: "Company limited by shares",
      subCategory: "Non-government company",
      listingStatus: "Unlisted",
      origin: "Indian",
      incorporationDate: "2019-08-26",
      roc: "RoC-Bangalore",
      state: "Karnataka",
      nicCode: "67190",
      industry: "Financial technology",
      principalActivity: "Other activities auxiliary to financial intermediation",
      authorizedCapital: 200 * L,
      paidUpCapital: 146 * L,
      email: "legal@fintrail.example",
      lastAgmDate: "2025-09-26",
      lastBalanceSheetDate: "2025-03-31",
      ...demoMeta,
    },
    addresses: [{ line: "WeWork Galaxy, 43 Residency Road", city: "Bengaluru", state: "Karnataka", pincode: "560025", effectiveFrom: "2019-08-26" }],
    directors: [
      role(P.ananya, "Director", "2019-08-26"),
      role(P.nikhil, "Director", "2019-08-26"),
      role(P.joseph, "Nominee Director", "2022-02-14"),
      role(P.harpreet, "Nominee Director", "2023-05-10"),
    ],
    filings: [
      ...annualFilings({ from: 2019, to: 2024, forms: ["AOC-4", "MGT-7"] }),
      filing("INC-20A", "2019-10-30", { eventDate: "2019-10-21" }),
      filing("PAS-3", "2021-06-15", { eventDate: "2021-06-02" }),
      filing("DIR-12", "2022-02-24", { eventDate: "2022-02-14" }),
      filing("SH-7", "2022-10-20", { eventDate: "2022-10-07" }),
      filing("MGT-14", "2022-10-21", { eventDate: "2022-10-07" }),
      filing("PAS-3", "2022-11-08", { eventDate: "2022-10-28" }),
      filing("DIR-12", "2023-05-22", { eventDate: "2023-05-10" }),
      filing("CHG-1", "2023-11-16", { eventDate: "2023-11-02" }),
      filing("PAS-3", "2025-01-20", { eventDate: "2025-01-08" }),
    ],
    financials: financials(2020, [
      [35, 12, 4, 0, -180, -180, 420, 510, 0, 62],
      [210, 30, 12, 1, -640, -640, 2280, 2600, 0, 98],
      [780, 85, 28, 6, -1120, -1120, 4160, 4700, 0, 128],
      [1640, 140, 46, 12, -860, -860, 3300, 3950, 250, 128],
      [2710, 110, 62, 22, -310, -310, 4990, 5800, 400, 146],
    ]),
    charges: [charge("100671209", "Sahyadri Commercial Bank Limited", 500, "2023-11-02", { propertyDescription: "Working capital — book debts" })],
  },

  // ── G. Public unlisted textile company with no operating revenue ──────────
  {
    sourceId: DEMO_SOURCE_ID,
    rawResponseHash: "demo-gangotri-v1",
    entity: {
      kind: "company",
      identifier: "U17120GJ2005PLC999107",
      name: "GANGOTRI TEXTILES LIMITED",
      status: "Active",
      companyClass: "Public",
      category: "Company limited by shares",
      subCategory: "Non-government company",
      listingStatus: "Unlisted",
      origin: "Indian",
      incorporationDate: "2005-01-18",
      roc: "RoC-Ahmedabad",
      state: "Gujarat",
      nicCode: "17120",
      industry: "Textiles",
      principalActivity: "Weaving, manufacture of cotton and cotton mixture fabrics",
      authorizedCapital: 500 * L,
      paidUpCapital: 410 * L,
      email: "gangotri.tex@example.com",
      lastAgmDate: "2025-09-27",
      lastBalanceSheetDate: "2025-03-31",
      ...demoMeta,
    },
    addresses: [{ line: "Survey No. 211, Narol-Aslali Highway", city: "Ahmedabad", state: "Gujarat", pincode: "382405", effectiveFrom: "2005-01-18" }],
    directors: [
      role(P.rakesh, "Managing Director", "2005-01-18"),
      role(P.suresh, "Director", "2005-01-18"),
      role(P.lakshmi, "Director", "2014-09-30"),
      role(P.kavita, "Director", "2016-03-12"),
    ],
    filings: [
      ...annualFilings({ from: 2019, to: 2024, forms: ["AOC-4", "MGT-7"] }),
      filing("CHG-1", "2008-04-24", { eventDate: "2008-04-10" }),
      filing("DIR-12", "2014-10-10", { eventDate: "2014-09-30" }),
      filing("DIR-12", "2016-03-22", { eventDate: "2016-03-12" }),
      filing("CHG-1", "2018-02-05", { eventDate: "2018-01-22" }),
      filing("ADT-1", "2019-10-15", { eventDate: "2019-09-30" }),
      filing("CHG-4", "2023-06-12", { eventDate: "2023-05-30" }),
      filing("ADT-1", "2024-10-16", { eventDate: "2024-09-27" }),
    ],
    financials: financials(2020, [
      [310, 45, 38, 12, -20, -20, 860, 1120, 140, 410],
      [120, 40, 36, 10, -55, -55, 805, 1040, 120, 410],
      [18, 52, 30, 8, -18, -18, 787, 990, 90, 410],
      [0, 48, 25, 6, 17, 12, 799, 960, 60, 410],
      [0, 51, 21, 4, 26, 19, 818, 955, 40, 410],
    ]),
    charges: [
      charge("100089311", "Gujarat Mercantile Bank Limited", 350, "2008-04-10", { satisfactionDate: "2023-05-30", propertyDescription: "Factory land and building" }),
      charge("100299018", "Western Coast Bank Limited", 150, "2018-01-22", { propertyDescription: "Plant and machinery" }),
    ],
  },

  // ── H. One Person Company with partial financial disclosures ──────────────
  {
    sourceId: DEMO_SOURCE_ID,
    rawResponseHash: "demo-harbourline-v1",
    entity: {
      kind: "company",
      identifier: "U50120KL2020OPC999108",
      name: "HARBOURLINE SHIPPING SERVICES (OPC) PRIVATE LIMITED",
      status: "Active",
      companyClass: "One Person Company",
      category: "Company limited by shares",
      subCategory: "Non-government company",
      listingStatus: "Unlisted",
      origin: "Indian",
      incorporationDate: "2020-10-05",
      roc: "RoC-Ernakulam",
      state: "Kerala",
      nicCode: "50120",
      industry: "Water transport",
      principalActivity: "Sea and coastal freight water transport",
      authorizedCapital: 10 * L,
      paidUpCapital: 10 * L,
      email: null,
      lastAgmDate: null,
      lastBalanceSheetDate: "2025-03-31",
      ...demoMeta,
    },
    addresses: [{ line: "XL/2146, Marine Drive, Ernakulam", city: "Kochi", state: "Kerala", pincode: "682031", effectiveFrom: "2020-10-05" }],
    directors: [role(P.anil, "Director", "2020-10-05")],
    filings: [
      ...annualFilings({ from: 2020, to: 2024, forms: ["AOC-4", "MGT-7A"], isOpc: true, late: { "2023-24:AOC-4": 21 } }),
      filing("INC-20A", "2021-01-12", { eventDate: "2021-01-04" }),
    ],
    financials: financials(2021, [
      [62, 1, null, 0, 5, 4, 14, 30, null, 10],
      [88, 1, null, 0, 9, 7, 21, 41, null, 10],
      [97, 2, null, 1, 11, 8, 29, 52, null, 10],
      [104, 2, null, 1, 12, 9, 38, 60, null, 10],
    ]),
    charges: [],
  },

  // ── I. LLP: advisory firm sharing partners with a company group ───────────
  {
    sourceId: DEMO_SOURCE_ID,
    rawResponseHash: "demo-indus-v1",
    entity: {
      kind: "llp",
      identifier: "ZZA-0001",
      name: "INDUS ADVISORY PARTNERS LLP",
      status: "Active",
      incorporationDate: "2016-07-11",
      roc: "RoC-Delhi",
      state: "Delhi",
      industry: "Management consultancy",
      principalActivity: "Business and management consultancy activities",
      totalContribution: 25 * L,
      numberOfPartners: 3,
      numberOfDesignatedPartners: 3,
      email: "partners@indus-advisory.example",
      ...demoMeta,
    },
    addresses: [{ line: "A-14, Defence Colony", city: "New Delhi", state: "Delhi", pincode: "110024", effectiveFrom: "2016-07-11" }],
    directors: [
      role(P.priya, "Designated Partner", "2016-07-11"),
      role(P.suresh, "Designated Partner", "2016-07-11"),
      role(P.nisha, "Designated Partner", "2020-02-01"),
    ],
    filings: [
      ...annualFilings({ from: 2019, to: 2024, forms: ["LLP Form 11", "LLP Form 8"], late: { "2022-23:LLP Form 8": 67 } }),
      filing("LLP Form 4", "2020-02-15", { eventDate: "2020-02-01" }),
      filing("LLP Form 3", "2020-02-20", { eventDate: "2020-02-01" }),
    ],
    financials: financials(2020, [
      [145, 2, null, null, null, 38, 61, 88, null, null],
      [168, 3, null, null, null, 44, 72, 97, null, null],
      [190, 3, null, null, null, 52, 81, 110, null, null],
      [214, 4, null, null, null, 57, 88, 121, null, null],
      [236, 5, null, null, null, 63, 96, 130, null, null],
    ]),
    charges: [],
  },

  // ── J. LLP with no recent annual filings in the available data ────────────
  {
    sourceId: DEMO_SOURCE_ID,
    rawResponseHash: "demo-jaipur-v1",
    entity: {
      kind: "llp",
      identifier: "ZZA-0002",
      name: "JAIPUR HERITAGE CRAFTS LLP",
      status: "Active",
      incorporationDate: "2018-03-02",
      roc: "RoC-Jaipur",
      state: "Rajasthan",
      industry: "Handicrafts",
      principalActivity: "Manufacture of handicraft articles",
      totalContribution: 5 * L,
      numberOfPartners: 2,
      numberOfDesignatedPartners: 2,
      email: null,
      ...demoMeta,
    },
    addresses: [{ line: "12, Johari Bazaar", city: "Jaipur", state: "Rajasthan", pincode: "302003", effectiveFrom: "2018-03-02" }],
    directors: [role(P.kavita, "Designated Partner", "2018-03-02"), role(P.tanvi, "Designated Partner", "2018-03-02")],
    filings: [
      ...annualFilings({
        from: 2018,
        to: 2024,
        forms: ["LLP Form 11", "LLP Form 8"],
        missing: ["2022-23:LLP Form 11", "2022-23:LLP Form 8", "2023-24:LLP Form 11", "2023-24:LLP Form 8", "2024-25:LLP Form 11", "2024-25:LLP Form 8"],
      }),
    ],
    financials: financials(2019, [
      [28, 0, null, null, null, 3, 9, 26, null, null],
      [12, 0, null, null, null, -2, 7, 25, null, null],
      [19, 0, null, null, null, 1, 8, 24, null, null],
    ]),
    charges: [charge("100455170", "Rajputana Gramin Bank", 20, "2019-06-10", { propertyDescription: "Stock of handicraft goods" })],
  },
];
