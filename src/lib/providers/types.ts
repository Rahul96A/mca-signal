/**
 * Provider contract. Every data source (demo, data.gov.in, third-party MCA API) maps its native
 * response into these raw-but-normalised shapes. The persistence layer stores them with provenance,
 * and the frontend never sees provider-specific formats.
 *
 * Convention: a section that is `undefined` means "this provider does not supply this section";
 * an empty array means "provider supplies it and there are no records".
 */
import type { EntityKind, SourceCategory } from "../domain/types";

export interface ProviderSourceInfo {
  id: string;
  name: string;
  category: SourceCategory;
  url: string;
  license: string;
  description: string;
}

export interface RawEntity {
  kind: EntityKind;
  identifier: string;
  name: string;
  status?: string | null;
  companyClass?: string | null;
  category?: string | null;
  subCategory?: string | null;
  listingStatus?: string | null;
  origin?: string | null;
  incorporationDate?: string | null;
  roc?: string | null;
  state?: string | null;
  nicCode?: string | null;
  industry?: string | null;
  principalActivity?: string | null;
  authorizedCapital?: number | null;
  paidUpCapital?: number | null;
  totalContribution?: number | null;
  numberOfPartners?: number | null;
  numberOfDesignatedPartners?: number | null;
  email?: string | null;
  lastAgmDate?: string | null;
  lastBalanceSheetDate?: string | null;
  sourceRecordId?: string | null;
  publishedAt?: string | null;
  lastUpdatedAt?: string | null;
}

export interface RawAddress {
  addressType?: string;
  line: string;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

export interface RawNameHistory {
  previousName: string;
  changedOn?: string | null;
}

export interface RawDirectorRole {
  din: string;
  name: string;
  nationality?: string | null;
  dinStatus?: string | null;
  designation?: string | null;
  appointmentDate?: string | null;
  cessationDate?: string | null;
}

export interface RawFiling {
  formType: string;
  formDescription?: string | null;
  financialYear?: string | null;
  filingDate?: string | null;
  dueDate?: string | null;
  eventDate?: string | null;
  status?: string | null;
  srn?: string | null;
  documentAvailable?: boolean;
  documentUrl?: string | null;
  sourceRecordId?: string | null;
}

/** Monetary values in INR. Only values present in the source are set — never estimated here. */
export interface RawFinancial {
  financialYear: string;
  periodEnd?: string | null;
  revenue?: number | null;
  otherIncome?: number | null;
  totalIncome?: number | null;
  totalExpenses?: number | null;
  depreciation?: number | null;
  financeCost?: number | null;
  profitBeforeTax?: number | null;
  profitAfterTax?: number | null;
  ebitda?: number | null;
  netWorth?: number | null;
  totalAssets?: number | null;
  totalLiabilities?: number | null;
  borrowings?: number | null;
  paidUpCapital?: number | null;
  filingSrn?: string | null;
}

export interface RawCharge {
  chargeId: string;
  holderName: string;
  amount?: number | null;
  creationDate?: string | null;
  modificationDate?: string | null;
  satisfactionDate?: string | null;
  status?: "open" | "satisfied";
  propertyDescription?: string | null;
}

export interface ProviderEntityBundle {
  sourceId: string;
  entity?: RawEntity;
  addresses?: RawAddress[];
  nameHistory?: RawNameHistory[];
  directors?: RawDirectorRole[];
  filings?: RawFiling[];
  financials?: RawFinancial[];
  charges?: RawCharge[];
  rawResponseHash: string;
}

export interface ProviderSearchHit {
  kind: EntityKind;
  identifier: string;
  name: string;
  status?: string | null;
  state?: string | null;
  incorporationDate?: string | null;
}

export interface ProviderCapabilities {
  masterData: boolean;
  nameSearch: "exact" | "fuzzy" | "none";
  directors: boolean;
  filings: boolean;
  financials: boolean;
  charges: boolean;
  directorLookup: boolean;
  bulkSync: boolean;
}

export interface DataProvider {
  readonly source: ProviderSourceInfo;
  readonly capabilities: ProviderCapabilities;
  isConfigured(): boolean;
  /** Fetch everything the provider knows about one CIN/LLPIN. Returns null when not found. */
  fetchEntity(identifier: string): Promise<ProviderEntityBundle | null>;
  /** Remote search (optional). Local DB search is always preferred for fuzzy matching. */
  search?(query: string, limit: number): Promise<ProviderSearchHit[]>;
  /** Director lookup by DIN (optional). */
  fetchDirectorEntities?(din: string): Promise<ProviderSearchHit[]>;
  /** Bulk master-data pages for the background sync worker (optional). */
  fetchMasterPage?(args: { offset: number; limit: number; stateCode?: string }): Promise<{ bundles: ProviderEntityBundle[]; total: number }>;
}
