/**
 * Normalisation → database. Upserts an entity and replaces each child section supplied by a given
 * source (snapshot semantics per source), preserving provenance on every row.
 */
import { createHash } from "node:crypto";
import type { Db } from "./client";
import { normalizeName } from "../identifiers";
import type { EntityKind } from "../domain/types";
import type { ProviderEntityBundle } from "../providers/types";

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(typeof payload === "string" ? payload : JSON.stringify(payload)).digest("hex");
}

export interface OwnerRef {
  kind: EntityKind;
  id: string;
}

const ownerCol = (kind: EntityKind) => (kind === "company" ? "company_id" : "llp_id");

export async function findOwner(db: Db, identifier: string): Promise<OwnerRef | null> {
  const c = await db.query<{ id: string }>(`select id from companies where cin = $1`, [identifier]);
  if (c[0]) return { kind: "company", id: c[0].id };
  const l = await db.query<{ id: string }>(`select id from llps where llpin = $1`, [identifier]);
  if (l[0]) return { kind: "llp", id: l[0].id };
  return null;
}

async function upsertEntity(db: Db, b: ProviderEntityBundle): Promise<OwnerRef> {
  const e = b.entity!;
  const prov = [b.sourceId, e.sourceRecordId ?? e.identifier, e.publishedAt ?? null, e.lastUpdatedAt ?? null, b.rawResponseHash];
  if (e.kind === "company") {
    // COALESCE(new, old): a provider that lacks a field never blanks data supplied earlier.
    const rows = await db.query<{ id: string }>(
      `insert into companies (cin, name, normalized_name, status, company_class, category, sub_category, listing_status, origin,
          incorporation_date, roc, state, nic_code, industry, principal_activity, authorized_capital, paid_up_capital, email,
          last_agm_date, last_balance_sheet_date, source_id, source_record_id, published_at, last_updated_at, raw_response_hash, fetched_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25, now())
       on conflict (cin) do update set
          name = excluded.name, normalized_name = excluded.normalized_name,
          status = coalesce(excluded.status, companies.status),
          company_class = coalesce(excluded.company_class, companies.company_class),
          category = coalesce(excluded.category, companies.category),
          sub_category = coalesce(excluded.sub_category, companies.sub_category),
          listing_status = coalesce(excluded.listing_status, companies.listing_status),
          origin = coalesce(excluded.origin, companies.origin),
          incorporation_date = coalesce(excluded.incorporation_date, companies.incorporation_date),
          roc = coalesce(excluded.roc, companies.roc),
          state = coalesce(excluded.state, companies.state),
          nic_code = coalesce(excluded.nic_code, companies.nic_code),
          industry = coalesce(excluded.industry, companies.industry),
          principal_activity = coalesce(excluded.principal_activity, companies.principal_activity),
          authorized_capital = coalesce(excluded.authorized_capital, companies.authorized_capital),
          paid_up_capital = coalesce(excluded.paid_up_capital, companies.paid_up_capital),
          email = coalesce(excluded.email, companies.email),
          last_agm_date = coalesce(excluded.last_agm_date, companies.last_agm_date),
          last_balance_sheet_date = coalesce(excluded.last_balance_sheet_date, companies.last_balance_sheet_date),
          source_id = excluded.source_id, source_record_id = excluded.source_record_id,
          published_at = excluded.published_at, last_updated_at = excluded.last_updated_at,
          raw_response_hash = excluded.raw_response_hash, fetched_at = now()
       returning id`,
      [
        e.identifier, e.name, normalizeName(e.name), e.status ?? null, e.companyClass ?? null, e.category ?? null, e.subCategory ?? null,
        e.listingStatus ?? null, e.origin ?? null, e.incorporationDate ?? null, e.roc ?? null, e.state ?? null, e.nicCode ?? null,
        e.industry ?? null, e.principalActivity ?? null, e.authorizedCapital ?? null, e.paidUpCapital ?? null, e.email ?? null,
        e.lastAgmDate ?? null, e.lastBalanceSheetDate ?? null, ...prov,
      ],
    );
    return { kind: "company", id: rows[0].id };
  }
  const rows = await db.query<{ id: string }>(
    `insert into llps (llpin, name, normalized_name, status, incorporation_date, roc, state, industry, principal_activity,
        total_contribution, number_of_partners, number_of_designated_partners, email,
        source_id, source_record_id, published_at, last_updated_at, raw_response_hash, fetched_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, now())
     on conflict (llpin) do update set
        name = excluded.name, normalized_name = excluded.normalized_name,
        status = coalesce(excluded.status, llps.status),
        incorporation_date = coalesce(excluded.incorporation_date, llps.incorporation_date),
        roc = coalesce(excluded.roc, llps.roc),
        state = coalesce(excluded.state, llps.state),
        industry = coalesce(excluded.industry, llps.industry),
        principal_activity = coalesce(excluded.principal_activity, llps.principal_activity),
        total_contribution = coalesce(excluded.total_contribution, llps.total_contribution),
        number_of_partners = coalesce(excluded.number_of_partners, llps.number_of_partners),
        number_of_designated_partners = coalesce(excluded.number_of_designated_partners, llps.number_of_designated_partners),
        email = coalesce(excluded.email, llps.email),
        source_id = excluded.source_id, source_record_id = excluded.source_record_id,
        published_at = excluded.published_at, last_updated_at = excluded.last_updated_at,
        raw_response_hash = excluded.raw_response_hash, fetched_at = now()
     returning id`,
    [
      e.identifier, e.name, normalizeName(e.name), e.status ?? null, e.incorporationDate ?? null, e.roc ?? null, e.state ?? null,
      e.industry ?? null, e.principalActivity ?? null, e.totalContribution ?? null, e.numberOfPartners ?? null,
      e.numberOfDesignatedPartners ?? null, e.email ?? null, ...prov,
    ],
  );
  return { kind: "llp", id: rows[0].id };
}

/**
 * Persist one provider bundle. `identifier` is required when the bundle carries only child
 * sections (e.g. a third-party provider supplying filings for an entity whose master data came
 * from data.gov.in). Returns the owner, or null if the entity is unknown.
 */
export async function persistBundle(db: Db, bundle: ProviderEntityBundle, identifier?: string): Promise<{ owner: OwnerRef | null; upserted: number }> {
  return db.transaction(async (tx) => {
    let upserted = 0;
    let owner: OwnerRef | null = null;
    if (bundle.entity) {
      owner = await upsertEntity(tx, bundle);
      upserted++;
    } else if (identifier) {
      owner = await findOwner(tx, identifier);
    }
    if (!owner) return { owner: null, upserted };

    const col = ownerCol(owner.kind);
    const src = bundle.sourceId;
    const hash = bundle.rawResponseHash;
    const clear = (table: string) => tx.query(`delete from ${table} where ${col} = $1 and source_id = $2`, [owner!.id, src]);

    if (bundle.addresses) {
      await clear("addresses");
      for (const a of bundle.addresses) {
        await tx.query(
          `insert into addresses (${col}, address_type, line, city, state, pincode, country, effective_from, effective_to, source_id, raw_response_hash)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [owner.id, a.addressType ?? "registered", a.line, a.city ?? null, a.state ?? null, a.pincode ?? null, a.country ?? "India", a.effectiveFrom ?? null, a.effectiveTo ?? null, src, hash],
        );
        upserted++;
      }
    }

    if (bundle.nameHistory) {
      await clear("company_name_history");
      for (const n of bundle.nameHistory) {
        await tx.query(`insert into company_name_history (${col}, previous_name, changed_on, source_id, raw_response_hash) values ($1,$2,$3,$4,$5)`, [
          owner.id, n.previousName, n.changedOn ?? null, src, hash,
        ]);
        upserted++;
      }
    }

    if (bundle.directors) {
      await clear("company_directors");
      for (const d of bundle.directors) {
        const dir = await tx.query<{ id: string }>(
          `insert into directors (din, name, normalized_name, nationality, din_status, source_id, source_record_id, raw_response_hash)
           values ($1,$2,$3,$4,$5,$6,$1,$7)
           on conflict (din) do update set name = excluded.name, normalized_name = excluded.normalized_name,
             nationality = coalesce(excluded.nationality, directors.nationality), din_status = coalesce(excluded.din_status, directors.din_status),
             fetched_at = now()
           returning id`,
          [d.din, d.name, normalizeName(d.name), d.nationality ?? null, d.dinStatus ?? null, src, hash],
        );
        await tx.query(
          `insert into company_directors (director_id, ${col}, designation, appointment_date, cessation_date, source_id, raw_response_hash)
           values ($1,$2,$3,$4,$5,$6,$7)
           on conflict do nothing`,
          [dir[0].id, owner.id, d.designation ?? null, d.appointmentDate ?? null, d.cessationDate ?? null, src, hash],
        );
        upserted++;
      }
    }

    const filingIdBySrn = new Map<string, string>();
    if (bundle.filings) {
      await clear("filings");
      for (const f of bundle.filings) {
        const r = await tx.query<{ id: string }>(
          `insert into filings (${col}, form_type, form_description, financial_year, filing_date, due_date, event_date, status, srn,
             document_available, document_url, source_id, source_record_id, raw_response_hash)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
          [owner.id, f.formType, f.formDescription ?? null, f.financialYear ?? null, f.filingDate ?? null, f.dueDate ?? null, f.eventDate ?? null,
            f.status ?? null, f.srn ?? null, f.documentAvailable ?? false, f.documentUrl ?? null, src, f.sourceRecordId ?? f.srn ?? null, hash],
        );
        if (f.srn) filingIdBySrn.set(f.srn, r[0].id);
        upserted++;
      }
    }

    if (bundle.financials) {
      await clear("financials");
      for (const f of bundle.financials) {
        // Link to the AOC-4 / LLP Form 8 for the same FY when the source didn't give an SRN.
        let filingId = f.filingSrn ? filingIdBySrn.get(f.filingSrn) ?? null : null;
        if (!filingId) {
          const link = await tx.query<{ id: string }>(
            `select id from filings where ${col} = $1 and financial_year = $2 and form_type in ('AOC-4','AOC-4 XBRL','LLP Form 8') order by filing_date desc limit 1`,
            [owner.id, f.financialYear],
          );
          filingId = link[0]?.id ?? null;
        }
        await tx.query(
          `insert into financials (${col}, financial_year, period_end, revenue, other_income, total_income, total_expenses, depreciation, finance_cost,
             profit_before_tax, profit_after_tax, ebitda, net_worth, total_assets, total_liabilities, borrowings, paid_up_capital, filing_id,
             source_id, raw_response_hash)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           on conflict (coalesce(company_id, llp_id), financial_year) do update set
             period_end = excluded.period_end, revenue = excluded.revenue, other_income = excluded.other_income, total_income = excluded.total_income,
             total_expenses = excluded.total_expenses, depreciation = excluded.depreciation, finance_cost = excluded.finance_cost,
             profit_before_tax = excluded.profit_before_tax, profit_after_tax = excluded.profit_after_tax, ebitda = excluded.ebitda,
             net_worth = excluded.net_worth, total_assets = excluded.total_assets, total_liabilities = excluded.total_liabilities,
             borrowings = excluded.borrowings, paid_up_capital = excluded.paid_up_capital, filing_id = excluded.filing_id,
             source_id = excluded.source_id, raw_response_hash = excluded.raw_response_hash, fetched_at = now()`,
          [owner.id, f.financialYear, f.periodEnd ?? null, f.revenue ?? null, f.otherIncome ?? null, f.totalIncome ?? null, f.totalExpenses ?? null,
            f.depreciation ?? null, f.financeCost ?? null, f.profitBeforeTax ?? null, f.profitAfterTax ?? null, f.ebitda ?? null, f.netWorth ?? null,
            f.totalAssets ?? null, f.totalLiabilities ?? null, f.borrowings ?? null, f.paidUpCapital ?? null, filingId, src, hash],
        );
        upserted++;
      }
    }

    if (bundle.charges) {
      await clear("charges");
      for (const c of bundle.charges) {
        await tx.query(
          `insert into charges (${col}, charge_id, holder_name, amount, creation_date, modification_date, satisfaction_date, status, property_description,
             source_id, source_record_id, raw_response_hash)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$2,$11)
           on conflict (coalesce(company_id, llp_id), charge_id) do update set holder_name = excluded.holder_name, amount = excluded.amount,
             creation_date = excluded.creation_date, modification_date = excluded.modification_date, satisfaction_date = excluded.satisfaction_date,
             status = excluded.status, property_description = excluded.property_description, source_id = excluded.source_id, fetched_at = now()`,
          [owner.id, c.chargeId, c.holderName, c.amount ?? null, c.creationDate ?? null, c.modificationDate ?? null, c.satisfactionDate ?? null,
            c.status ?? (c.satisfactionDate ? "satisfied" : "open"), c.propertyDescription ?? null, src, hash],
        );
        upserted++;
      }
    }
    return { owner, upserted };
  });
}
