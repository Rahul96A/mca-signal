/** Read-side queries: DB rows → domain model, always with provenance attached. */
import type { Db } from "./client";
import type {
  Address,
  Charge,
  DataSource,
  DirectorProfile,
  DirectorRole,
  EntityKind,
  EntityProfile,
  Filing,
  NameHistoryEntry,
  Provenance,
  SourceCategory,
} from "../domain/types";
import { estimateDueDate } from "../domain/forms";
import type { OwnerRef } from "./persist";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const nOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const PROV_COLS = (alias: string) =>
  `${alias}.source_id, ${alias}.source_record_id, ${alias}.fetched_at, ${alias}.published_at, ${alias}.last_updated_at, ${alias}.raw_response_hash,
   ds.name as source_name, ds.category as source_category`;

function prov(r: Row): Provenance {
  return {
    sourceId: String(r.source_id),
    sourceName: String(r.source_name ?? r.source_id),
    sourceCategory: (r.source_category ?? "third_party") as SourceCategory,
    sourceRecordId: s(r.source_record_id),
    fetchedAt: s(r.fetched_at),
    publishedAt: s(r.published_at),
    lastUpdatedAt: s(r.last_updated_at),
    rawResponseHash: s(r.raw_response_hash),
  };
}

export const ownerCol = (kind: EntityKind) => (kind === "company" ? "company_id" : "llp_id");

export function yearsSince(date: string | null, now = new Date()): number | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round(((now.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000)) * 10) / 10;
}

export async function getSources(db: Db): Promise<DataSource[]> {
  const rows = await db.query<Row>(`select * from data_sources order by category, id`);
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    category: r.category as SourceCategory,
    url: s(r.url),
    license: s(r.license),
    description: s(r.description),
    lastSyncedAt: s(r.last_synced_at),
    publishedAt: s(r.published_at),
  }));
}

async function getAddresses(db: Db, owner: OwnerRef): Promise<Address[]> {
  const rows = await db.query<Row>(
    `select a.*, ${PROV_COLS("a")} from addresses a join data_sources ds on ds.id = a.source_id
     where a.${ownerCol(owner.kind)} = $1 order by a.effective_from desc nulls last`,
    [owner.id],
  );
  return rows.map((r) => ({
    id: String(r.id),
    addressType: String(r.address_type),
    line: String(r.line),
    city: s(r.city),
    state: s(r.state),
    pincode: s(r.pincode),
    country: s(r.country),
    effectiveFrom: s(r.effective_from),
    effectiveTo: s(r.effective_to),
    provenance: prov(r),
  }));
}

async function getNameHistory(db: Db, owner: OwnerRef): Promise<NameHistoryEntry[]> {
  const rows = await db.query<Row>(
    `select h.*, ${PROV_COLS("h")} from company_name_history h join data_sources ds on ds.id = h.source_id
     where h.${ownerCol(owner.kind)} = $1 order by h.changed_on desc nulls last`,
    [owner.id],
  );
  return rows.map((r) => ({ id: String(r.id), previousName: String(r.previous_name), changedOn: s(r.changed_on), provenance: prov(r) }));
}

export async function getProfile(db: Db, identifier: string): Promise<{ profile: EntityProfile; owner: OwnerRef } | null> {
  const c = await db.query<Row>(
    `select c.*, ${PROV_COLS("c")} from companies c join data_sources ds on ds.id = c.source_id where c.cin = $1`,
    [identifier],
  );
  let owner: OwnerRef;
  let base: Omit<EntityProfile, "registeredOffice" | "addressHistory" | "nameHistory">;
  if (c[0]) {
    const r = c[0];
    owner = { kind: "company", id: String(r.id) };
    base = {
      id: String(r.id),
      kind: "company",
      identifier: String(r.cin),
      name: String(r.name),
      status: s(r.status),
      companyClass: s(r.company_class),
      category: s(r.category),
      subCategory: s(r.sub_category),
      listingStatus: s(r.listing_status),
      origin: s(r.origin),
      incorporationDate: s(r.incorporation_date),
      ageYears: yearsSince(s(r.incorporation_date)),
      roc: s(r.roc),
      state: s(r.state),
      nicCode: s(r.nic_code),
      industry: s(r.industry),
      principalActivity: s(r.principal_activity),
      authorizedCapital: nOrNull(r.authorized_capital),
      paidUpCapital: nOrNull(r.paid_up_capital),
      totalContribution: null,
      email: s(r.email),
      lastAgmDate: s(r.last_agm_date),
      lastBalanceSheetDate: s(r.last_balance_sheet_date),
      provenance: prov(r),
    };
  } else {
    const l = await db.query<Row>(`select l.*, ${PROV_COLS("l")} from llps l join data_sources ds on ds.id = l.source_id where l.llpin = $1`, [identifier]);
    if (!l[0]) return null;
    const r = l[0];
    owner = { kind: "llp", id: String(r.id) };
    base = {
      id: String(r.id),
      kind: "llp",
      identifier: String(r.llpin),
      name: String(r.name),
      status: s(r.status),
      companyClass: "Limited Liability Partnership",
      category: null,
      subCategory: null,
      listingStatus: null,
      origin: null,
      incorporationDate: s(r.incorporation_date),
      ageYears: yearsSince(s(r.incorporation_date)),
      roc: s(r.roc),
      state: s(r.state),
      nicCode: null,
      industry: s(r.industry),
      principalActivity: s(r.principal_activity),
      authorizedCapital: null,
      paidUpCapital: null,
      totalContribution: nOrNull(r.total_contribution),
      email: s(r.email),
      lastAgmDate: null,
      lastBalanceSheetDate: s(r.last_financial_statement_date),
      provenance: prov(r),
    };
  }
  const [addressHistory, nameHistory] = await Promise.all([getAddresses(db, owner), getNameHistory(db, owner)]);
  const registeredOffice = addressHistory.find((a) => a.addressType === "registered" && !a.effectiveTo) ?? addressHistory[0] ?? null;
  return { owner, profile: { ...base, registeredOffice, addressHistory, nameHistory } };
}

export async function getDirectorRoles(db: Db, owner: OwnerRef): Promise<DirectorRole[]> {
  const rows = await db.query<Row>(
    `select cd.*, d.din, d.name, ${PROV_COLS("cd")}
     from company_directors cd join directors d on d.id = cd.director_id join data_sources ds on ds.id = cd.source_id
     where cd.${ownerCol(owner.kind)} = $1
     order by (cd.cessation_date is null) desc, cd.appointment_date asc nulls last`,
    [owner.id],
  );
  return rows.map((r) => ({
    id: String(r.id),
    directorId: String(r.director_id),
    din: String(r.din),
    name: String(r.name),
    designation: s(r.designation),
    appointmentDate: s(r.appointment_date),
    cessationDate: s(r.cessation_date),
    isCurrent: !r.cessation_date,
    provenance: prov(r),
  }));
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function mapFiling(r: Row, companyClass: string | null): Filing {
  const provided = s(r.due_date);
  const est = provided ? null : estimateDueDate(String(r.form_type), s(r.financial_year), { isOpc: companyClass === "One Person Company" });
  const due = provided ?? est;
  const filed = s(r.filing_date);
  const delay = due && filed ? daysBetween(due, filed) : null;
  return {
    id: String(r.id),
    formType: String(r.form_type),
    formDescription: s(r.form_description),
    financialYear: s(r.financial_year),
    filingDate: filed,
    dueDate: due,
    dueDateBasis: provided ? "provided" : est ? "statutory_estimate" : null,
    eventDate: s(r.event_date),
    status: s(r.status),
    srn: s(r.srn),
    documentAvailable: Boolean(r.document_available),
    documentUrl: s(r.document_url),
    delayDays: delay !== null && delay > 0 ? delay : delay === null ? null : 0,
    provenance: prov(r),
  };
}

export async function getFilings(
  db: Db,
  owner: OwnerRef,
  companyClass: string | null,
  opts: { page?: number; pageSize?: number; formType?: string; year?: string } = {},
): Promise<{ items: Filing[]; total: number; formTypes: string[] }> {
  const where = [`f.${ownerCol(owner.kind)} = $1`];
  const params: unknown[] = [owner.id];
  if (opts.formType) {
    params.push(opts.formType);
    where.push(`f.form_type = $${params.length}`);
  }
  if (opts.year) {
    params.push(opts.year);
    where.push(`(f.financial_year = $${params.length} or to_char(f.filing_date, 'YYYY') = $${params.length})`);
  }
  const whereSql = where.join(" and ");
  const total = (await db.query<{ n: number }>(`select count(*)::int as n from filings f where ${whereSql}`, params))[0].n;
  let limitSql = "";
  if (opts.pageSize) {
    const page = Math.max(1, opts.page ?? 1);
    limitSql = ` limit ${Math.min(opts.pageSize, 500)} offset ${(page - 1) * opts.pageSize}`;
  }
  const rows = await db.query<Row>(
    `select f.*, ${PROV_COLS("f")} from filings f join data_sources ds on ds.id = f.source_id
     where ${whereSql} order by f.filing_date desc nulls last, f.form_type${limitSql}`,
    params,
  );
  const formTypes = (await db.query<{ form_type: string }>(`select distinct form_type from filings where ${ownerCol(owner.kind)} = $1 order by 1`, [owner.id])).map((r) => r.form_type);
  return { items: rows.map((r) => mapFiling(r, companyClass)), total, formTypes };
}

export async function getFinancialRows(db: Db, owner: OwnerRef): Promise<Array<Row & { provenance: Provenance }>> {
  const rows = await db.query<Row>(
    `select f.*, ${PROV_COLS("f")} from financials f join data_sources ds on ds.id = f.source_id
     where f.${ownerCol(owner.kind)} = $1 order by f.financial_year asc`,
    [owner.id],
  );
  return rows.map((r) => ({ ...r, provenance: prov(r) }));
}

export async function getCharges(db: Db, owner: OwnerRef): Promise<Charge[]> {
  const rows = await db.query<Row>(
    `select c.*, ${PROV_COLS("c")} from charges c join data_sources ds on ds.id = c.source_id
     where c.${ownerCol(owner.kind)} = $1 order by (c.status = 'open') desc, c.creation_date desc nulls last`,
    [owner.id],
  );
  return rows.map((r) => ({
    id: String(r.id),
    chargeId: String(r.charge_id),
    holderName: String(r.holder_name),
    amount: nOrNull(r.amount),
    creationDate: s(r.creation_date),
    modificationDate: s(r.modification_date),
    satisfactionDate: s(r.satisfaction_date),
    status: r.status === "satisfied" ? "satisfied" : "open",
    propertyDescription: s(r.property_description),
    provenance: prov(r),
  }));
}

/** All roles (company + LLP) held by the given directors. */
export async function getRolesForDirectorIds(db: Db, directorIds: string[]) {
  if (!directorIds.length) return [];
  return db.query<{
    director_id: string;
    din: string;
    director_name: string;
    entity_kind: EntityKind;
    entity_identifier: string;
    entity_name: string;
    entity_status: string | null;
    designation: string | null;
    appointment_date: string | null;
    cessation_date: string | null;
  }>(
    `select cd.director_id, d.din, d.name as director_name,
            case when cd.company_id is not null then 'company' else 'llp' end as entity_kind,
            coalesce(c.cin, l.llpin) as entity_identifier, coalesce(c.name, l.name) as entity_name, coalesce(c.status, l.status) as entity_status,
            cd.designation, cd.appointment_date, cd.cessation_date
     from company_directors cd
     join directors d on d.id = cd.director_id
     left join companies c on c.id = cd.company_id
     left join llps l on l.id = cd.llp_id
     where cd.director_id = any($1::uuid[])
     order by cd.appointment_date asc nulls last`,
    [directorIds],
  );
}

export async function getDirectorByDin(db: Db, din: string): Promise<DirectorProfile | null> {
  const rows = await db.query<Row>(`select d.*, ${PROV_COLS("d")} from directors d join data_sources ds on ds.id = d.source_id where d.din = $1`, [din]);
  const r = rows[0];
  if (!r) return null;
  const roles = await getRolesForDirectorIds(db, [String(r.id)]);
  return {
    id: String(r.id),
    din: String(r.din),
    name: String(r.name),
    nationality: s(r.nationality),
    dinStatus: s(r.din_status),
    provenance: prov(r),
    roles: roles.map((x) => ({
      entityKind: x.entity_kind,
      entityIdentifier: x.entity_identifier,
      entityName: x.entity_name,
      entityStatus: x.entity_status,
      designation: x.designation,
      appointmentDate: x.appointment_date,
      cessationDate: x.cessation_date,
      isCurrent: !x.cessation_date,
    })),
  };
}
