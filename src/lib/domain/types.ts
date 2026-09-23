/**
 * Normalised domain model shared by API, services and UI. Every record carries provenance so the UI
 * can always distinguish Official Government data, Third-Party Aggregated data, Demo data and
 * AI-derived analysis.
 */

export type EntityKind = "company" | "llp";
export type SourceCategory = "official_government" | "third_party" | "demo" | "ai_derived";
export type ValueBasis = "reported" | "calculated" | "derived";

export interface DataSource {
  id: string;
  name: string;
  category: SourceCategory;
  url: string | null;
  license: string | null;
  description: string | null;
  lastSyncedAt: string | null;
  publishedAt: string | null;
}

export interface Provenance {
  sourceId: string;
  sourceName: string;
  sourceCategory: SourceCategory;
  sourceRecordId: string | null;
  fetchedAt: string | null;
  publishedAt: string | null;
  lastUpdatedAt: string | null;
  rawResponseHash: string | null;
}

export interface Address {
  id: string;
  addressType: string;
  line: string;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  provenance: Provenance;
}

export interface NameHistoryEntry {
  id: string;
  previousName: string;
  changedOn: string | null;
  provenance: Provenance;
}

export interface EntityProfile {
  id: string;
  kind: EntityKind;
  identifier: string; // CIN or LLPIN
  name: string;
  status: string | null;
  companyClass: string | null;
  category: string | null;
  subCategory: string | null;
  listingStatus: string | null;
  origin: string | null;
  incorporationDate: string | null;
  ageYears: number | null;
  roc: string | null;
  state: string | null;
  nicCode: string | null;
  industry: string | null;
  principalActivity: string | null;
  authorizedCapital: number | null;
  paidUpCapital: number | null;
  totalContribution: number | null; // LLPs
  email: string | null;
  lastAgmDate: string | null;
  lastBalanceSheetDate: string | null;
  registeredOffice: Address | null;
  addressHistory: Address[];
  nameHistory: NameHistoryEntry[];
  provenance: Provenance;
}

export interface DirectorRole {
  id: string;
  directorId: string;
  din: string;
  name: string;
  designation: string | null;
  appointmentDate: string | null;
  cessationDate: string | null;
  isCurrent: boolean;
  provenance: Provenance;
}

export interface Filing {
  id: string;
  formType: string;
  formDescription: string | null;
  financialYear: string | null;
  filingDate: string | null;
  dueDate: string | null;
  dueDateBasis: "provided" | "statutory_estimate" | null;
  eventDate: string | null;
  status: string | null;
  srn: string | null;
  documentAvailable: boolean;
  documentUrl: string | null;
  delayDays: number | null;
  provenance: Provenance;
}

export const METRIC_KEYS = [
  "revenue",
  "otherIncome",
  "totalIncome",
  "totalExpenses",
  "depreciation",
  "financeCost",
  "profitBeforeTax",
  "profitAfterTax",
  "ebitda",
  "netWorth",
  "totalAssets",
  "totalLiabilities",
  "borrowings",
  "paidUpCapital",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export interface MetricValue {
  value: number | null;
  basis: ValueBasis | null; // null when value is unavailable
  formula?: string;
}

export interface FinancialYearRecord {
  id: string;
  financialYear: string; // e.g. "2023-24"
  periodEnd: string | null;
  metrics: Record<MetricKey, MetricValue>;
  filingId: string | null;
  provenance: Provenance;
}

export interface Charge {
  id: string;
  chargeId: string;
  holderName: string;
  amount: number | null;
  creationDate: string | null;
  modificationDate: string | null;
  satisfactionDate: string | null;
  status: "open" | "satisfied";
  propertyDescription: string | null;
  provenance: Provenance;
}

export interface DirectorProfile {
  id: string;
  din: string;
  name: string;
  nationality: string | null;
  dinStatus: string | null;
  provenance: Provenance;
  roles: Array<{
    entityKind: EntityKind;
    entityIdentifier: string;
    entityName: string;
    entityStatus: string | null;
    designation: string | null;
    appointmentDate: string | null;
    cessationDate: string | null;
    isCurrent: boolean;
  }>;
}

export interface SearchResult {
  type: "company" | "llp" | "director";
  identifier: string; // CIN, LLPIN or DIN
  name: string;
  status: string | null;
  state: string | null;
  incorporationDate: string | null;
  score: number;
  sourceCategory: SourceCategory;
  matchedOn: "identifier" | "name" | "director";
}

/** Reference to an underlying data record — used by risk signals and AI report citations. */
export interface RecordRef {
  ref: string; // stable short id, e.g. "filing:3f2a…" or "profile:status"
  type: "profile" | "filing" | "charge" | "director_role" | "financial" | "address" | "name_history" | "related_entity";
  label: string;
}

export type SignalSeverity = "info" | "review" | "attention";

export interface RiskSignal {
  id: string;
  category:
    | "status"
    | "directors"
    | "charges"
    | "filings"
    | "capital"
    | "address"
    | "activity"
    | "network"
    | "data_availability";
  severity: SignalSeverity;
  title: string;
  detail: string;
  evidence: RecordRef[];
}

export interface DataQuality {
  score: number; // 0–100 completeness
  sections: Record<string, { available: boolean; count: number; note?: string }>;
  freshestFetchAt: string | null;
  oldestFetchAt: string | null;
  sourceCategories: SourceCategory[];
}

export interface NetworkNode {
  id: string;
  type: "company" | "llp" | "director";
  label: string;
  identifier: string;
  status: string | null;
  depth: number;
  isRoot?: boolean;
}
export interface NetworkEdge {
  source: string;
  target: string;
  designation: string | null;
  isCurrent: boolean;
}
export interface NetworkGraph {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  commonDirectors: Array<{ entityIdentifier: string; entityName: string; entityKind: EntityKind; sharedDirectors: Array<{ din: string; name: string }> }>;
}

export interface ReportParagraph {
  text: string;
  citations: string[]; // RecordRef.ref values
}
export interface ReportSection {
  key: string;
  title: string;
  paragraphs: ReportParagraph[];
}
export interface CompanyReport {
  id: string;
  entityIdentifier: string;
  entityName: string;
  generatedAt: string;
  generator: "openai" | "rule_based";
  model: string | null;
  shareToken: string | null;
  sections: ReportSection[];
  references: Record<string, RecordRef>;
  dataMode: "demo" | "live";
}

export interface ApiMeta {
  dataMode: "demo" | "live";
  sources?: DataSource[];
  page?: number;
  pageSize?: number;
  total?: number;
  warnings?: string[];
  generatedAt: string;
}
