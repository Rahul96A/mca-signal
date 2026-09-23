/**
 * Due-diligence signals. Every signal is a factual observation from stored records, cites its
 * evidence, and uses neutral wording ("Potential review item", "Data point requiring further
 * verification"). No signal asserts wrongdoing.
 */
import type { Charge, DirectorRole, EntityProfile, Filing, RecordRef, RiskSignal } from "../domain/types";
import { estimateDueDate, fyLabel, fyStartYear } from "../domain/forms";
import type { FinancialAnalysis } from "./financials";

export interface RelatedEntity {
  identifier: string;
  name: string;
  kind: "company" | "llp";
  status: string | null;
  viaDin: string;
  viaName: string;
}

export interface RiskInput {
  profile: EntityProfile;
  directors: DirectorRole[] | null; // null = section not available from sources
  filings: Filing[] | null;
  financials: FinancialAnalysis | null;
  charges: Charge[] | null;
  related: RelatedEntity[];
  now?: Date;
}

export const fmtInr = (v: number | null) => {
  if (v === null) return "n/a";
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  return `${sign}₹${abs.toLocaleString("en-IN")}`;
};

const ACTIVE_RE = /^active/i;
const INACTIVE_RE = /strike|struck|dissolved|liquidat|amalgamat|converted|dormant|inactive|removed/i;

const monthsAgo = (now: Date, iso: string | null) =>
  iso ? (now.getTime() - Date.parse(`${iso}T00:00:00Z`)) / (30.44 * 86_400_000) : Infinity;

export const refs = {
  profile: (field: string, label: string): RecordRef => ({ ref: `profile:${field}`, type: "profile", label }),
  filing: (f: Filing): RecordRef => ({ ref: `filing:${f.id}`, type: "filing", label: `${f.formType}${f.financialYear ? ` FY ${f.financialYear}` : ""}${f.filingDate ? ` filed ${f.filingDate}` : ""}` }),
  charge: (c: Charge): RecordRef => ({ ref: `charge:${c.id}`, type: "charge", label: `Charge ${c.chargeId} — ${c.holderName}` }),
  role: (r: DirectorRole): RecordRef => ({ ref: `role:${r.id}`, type: "director_role", label: `${r.name} (DIN ${r.din})` }),
  fin: (fy: string, id: string): RecordRef => ({ ref: `fin:${id}`, type: "financial", label: `Financials FY ${fy}` }),
  entity: (e: RelatedEntity): RecordRef => ({ ref: `entity:${e.identifier}`, type: "related_entity", label: `${e.name} (${e.identifier})` }),
};

export function computeSignals(input: RiskInput): RiskSignal[] {
  const now = input.now ?? new Date();
  const { profile } = input;
  const out: RiskSignal[] = [];

  // 1. Status
  if (profile.status && !ACTIVE_RE.test(profile.status)) {
    out.push({
      id: "status-inactive",
      category: "status",
      severity: INACTIVE_RE.test(profile.status) ? "attention" : "review",
      title: `Registry status is "${profile.status}"`,
      detail: `The registry status recorded for this ${profile.kind === "llp" ? "LLP" : "company"} is "${profile.status}". Potential review item — confirm current status on the MCA portal before relying on it.`,
      evidence: [refs.profile("status", `Status: ${profile.status}`)],
    });
  }

  // 2–3. Director changes
  if (input.directors) {
    const events: Array<{ date: string; role: DirectorRole; type: "appointment" | "cessation" }> = [];
    for (const r of input.directors) {
      if (r.appointmentDate && r.appointmentDate !== profile.incorporationDate) events.push({ date: r.appointmentDate, role: r, type: "appointment" });
      if (r.cessationDate) events.push({ date: r.cessationDate, role: r, type: "cessation" });
    }
    const last12 = events.filter((e) => monthsAgo(now, e.date) <= 12);
    const last24 = events.filter((e) => monthsAgo(now, e.date) <= 24);
    const last36 = events.filter((e) => monthsAgo(now, e.date) <= 36);
    const last60 = events.filter((e) => monthsAgo(now, e.date) <= 60);
    if (last36.length >= 3 || last60.length >= 5) {
      const set = last36.length >= 3 ? last36 : last60;
      const window = last36.length >= 3 ? 36 : 60;
      out.push({
        id: "directors-frequent",
        category: "directors",
        severity: "review",
        title: `Frequent board changes: ${set.length} appointments/cessations in ${window} months`,
        detail: `${set
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((e) => `${e.role.name} — ${e.type} on ${e.date}`)
          .join("; ")}. Potential review item — the reasons for changes are not available in registry data.`,
        evidence: [...new Map(set.map((e) => [e.role.id, refs.role(e.role)])).values()],
      });
    } else if (last12.length > 0 || last24.length > 0) {
      const set = last12.length ? last12 : last24;
      out.push({
        id: "directors-recent",
        category: "directors",
        severity: "info",
        title: `Recent director change${set.length > 1 ? "s" : ""} (${set.length} in last ${last12.length ? 12 : 24} months)`,
        detail: set.map((e) => `${e.role.name} — ${e.type} on ${e.date}`).join("; "),
        evidence: set.map((e) => refs.role(e.role)),
      });
    }
    const current = input.directors.filter((r) => r.isCurrent);
    if (current.length === 0 && ACTIVE_RE.test(profile.status ?? "")) {
      out.push({
        id: "directors-none-current",
        category: "directors",
        severity: "review",
        title: "No current directors/partners in available data",
        detail: "Data point requiring further verification — the source returned no currently serving directors.",
        evidence: [refs.profile("directors", "Director records")],
      });
    }
  }

  // 4–5. Charges
  const latestFin = input.financials?.latest ?? null;
  if (input.charges) {
    const open = input.charges.filter((c) => c.status === "open");
    const openTotal = open.reduce((a, c) => a + (c.amount ?? 0), 0);
    if (open.length) {
      const nw = latestFin?.metrics.netWorth.value ?? null;
      const ratio = nw && nw > 0 ? openTotal / nw : null;
      out.push({
        id: "charges-open",
        category: "charges",
        severity: ratio !== null && ratio > 1.5 ? "review" : "info",
        title: `${open.length} open charge${open.length > 1 ? "s" : ""} totalling ${fmtInr(openTotal)}`,
        detail:
          `Registered charges not yet satisfied: ${open.map((c) => `${c.holderName} (${fmtInr(c.amount)})`).join(", ")}.` +
          (ratio !== null ? ` Open charge amount is ${ratio.toFixed(2)}× the latest reported net worth (FY ${latestFin!.financialYear}). Charge amounts are sanctioned limits, not necessarily outstanding balances.` : ""),
        evidence: [...open.map(refs.charge), ...(ratio !== null ? [refs.fin(latestFin!.financialYear, latestFin!.id)] : [])],
      });
    }
    const ta = latestFin?.metrics.totalAssets.value ?? null;
    const big = input.charges.filter((c) => {
      const recent = monthsAgo(now, c.creationDate) <= 24 || monthsAgo(now, c.modificationDate) <= 24;
      return recent && c.amount !== null && ta !== null && ta > 0 && c.amount >= 0.25 * ta;
    });
    if (big.length) {
      out.push({
        id: "charges-large-recent",
        category: "charges",
        severity: "review",
        title: "Large charge created or modified in the last 24 months",
        detail: `${big.map((c) => `${c.holderName}: ${fmtInr(c.amount)} (${c.modificationDate ? `modified ${c.modificationDate}` : `created ${c.creationDate}`})`).join("; ")} — each ≥25% of latest reported total assets. Potential review item.`,
        evidence: [...big.map(refs.charge), refs.fin(latestFin!.financialYear, latestFin!.id)],
      });
    }
  }

  // 6. Filing delays
  if (input.filings) {
    const delayed = input.filings.filter((f) => (f.delayDays ?? 0) > 0);
    const recentDelayed = delayed.filter((f) => monthsAgo(now, f.filingDate) <= 60);
    if (recentDelayed.length) {
      const estimated = recentDelayed.some((f) => f.dueDateBasis === "statutory_estimate");
      out.push({
        id: "filings-delayed",
        category: "filings",
        severity: recentDelayed.length >= 3 ? "review" : "info",
        title: `${recentDelayed.length} filing${recentDelayed.length > 1 ? "s" : ""} appear delayed based on available dates`,
        detail:
          recentDelayed.map((f) => `${f.formType} FY ${f.financialYear ?? "—"}: filed ${f.filingDate}, ${f.delayDays} days after ${f.dueDate}`).join("; ") +
          (estimated ? ". Some due dates are statutory estimates; AGM extensions or MCA relaxation circulars may apply." : "."),
        evidence: recentDelayed.map(refs.filing),
      });
    }

    // 11. Missing annual filings (only when the source supplies filings and entity is active)
    const annualForms = ["AOC-4", "AOC-4 XBRL", "AOC-4 CFS", "MGT-7", "MGT-7A", "LLP Form 8", "LLP Form 11"];
    const annualWithoutFy = input.filings.some((f) => annualForms.includes(f.formType) && !f.financialYear);
    if (annualWithoutFy) {
      out.push({
        id: "filings-fy-unavailable",
        category: "data_availability",
        severity: "info",
        title: "Annual-filing completeness not assessed",
        detail: "The data source does not state the financial year of annual filings, so missing or delayed annual returns / financial statements were not assessed rather than inferred.",
        evidence: [refs.profile("filings", "Filing records for entity")],
      });
    }
    if (!annualWithoutFy && ACTIVE_RE.test(profile.status ?? "") && profile.incorporationDate) {
      const inc = new Date(`${profile.incorporationDate}T00:00:00Z`);
      const firstFy = inc.getUTCMonth() >= 3 ? inc.getUTCFullYear() : inc.getUTCFullYear() - 1;
      const expected =
        profile.kind === "llp"
          ? [["LLP Form 11"], ["LLP Form 8"]]
          : [["AOC-4", "AOC-4 XBRL"], ["MGT-7", "MGT-7A"]];
      const missing: string[] = [];
      const currentFyStart = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
      for (let y = Math.max(firstFy, currentFyStart - 5); y < currentFyStart; y++) {
        const fy = fyLabel(y);
        for (const group of expected) {
          const due = estimateDueDate(group[0], fy, { isOpc: profile.companyClass === "One Person Company" });
          if (!due || Date.parse(`${due}T00:00:00Z`) > now.getTime()) continue;
          const found = input.filings.some((f) => group.includes(f.formType) && (f.financialYear === fy || fyStartYear(f.financialYear) === y));
          if (!found) missing.push(`${group[0]} FY ${fy}`);
        }
      }
      if (missing.length) {
        out.push({
          id: "filings-missing",
          category: "filings",
          severity: missing.length >= 3 ? "attention" : "review",
          title: `${missing.length} expected annual filing${missing.length > 1 ? "s" : ""} not found in available data`,
          detail: `${missing.join(", ")}. Data point requiring further verification — the filing may exist but be absent from the configured data sources.`,
          evidence: [refs.profile("filings", "Filing records for entity")],
        });
      }
    }
  } else {
    out.push({
      id: "filings-unavailable",
      category: "data_availability",
      severity: "info",
      title: "Filing history not available from configured sources",
      detail: "The configured data sources do not provide filing records for this entity. Filing-based checks were not performed.",
      evidence: [refs.profile("filings", "Filing records for entity")],
    });
  }

  // 7. Capital changes
  if (input.financials && input.financials.years.length >= 2) {
    const ys = input.financials.years;
    const changes: string[] = [];
    const ev: RecordRef[] = [];
    for (let i = 1; i < ys.length; i++) {
      const a = ys[i - 1].metrics.paidUpCapital.value;
      const b = ys[i].metrics.paidUpCapital.value;
      if (a && b && Math.abs(b - a) / a >= 0.25) {
        changes.push(`FY ${ys[i - 1].financialYear} → FY ${ys[i].financialYear}: ${fmtInr(a)} → ${fmtInr(b)}`);
        ev.push(refs.fin(ys[i].financialYear, ys[i].id));
      }
    }
    const allotments = (input.filings ?? []).filter((f) => ["PAS-3", "SH-7"].includes(f.formType) && monthsAgo(now, f.filingDate) <= 36);
    if (changes.length || allotments.length) {
      out.push({
        id: "capital-changes",
        category: "capital",
        severity: "info",
        title: "Significant share-capital changes",
        detail: [changes.length ? `Paid-up capital changed ≥25%: ${changes.join("; ")}.` : "", allotments.length ? `${allotments.length} allotment/capital-alteration filing(s) (PAS-3/SH-7) in last 36 months.` : ""].filter(Boolean).join(" "),
        evidence: [...ev, ...allotments.map(refs.filing)],
      });
    }
  }

  // 8. Registered office changes
  // ≥2 changes within 60 months → review item; a single change within 36 months → information.
  const moves = profile.addressHistory.filter((a) => a.effectiveFrom && a.effectiveFrom !== profile.incorporationDate && monthsAgo(now, a.effectiveFrom) <= 60);
  const inc22 = (input.filings ?? []).filter((f) => ["INC-22", "LLP Form 15"].includes(f.formType) && monthsAgo(now, f.filingDate) <= 60);
  if (moves.length >= 2 || inc22.length >= 2) {
    out.push({
      id: "address-changes",
      category: "address",
      severity: "review",
      title: `Registered office changed ${Math.max(moves.length, inc22.length)} times in 60 months`,
      detail: moves.map((a) => `${a.line}, ${a.city ?? ""} from ${a.effectiveFrom}`).join("; ") + ". Potential review item.",
      evidence: [...moves.map((a) => ({ ref: `address:${a.id}`, type: "address" as const, label: `Address from ${a.effectiveFrom}` })), ...inc22.map(refs.filing)],
    });
  } else if (moves.length === 1 && monthsAgo(now, moves[0].effectiveFrom) <= 36) {
    out.push({
      id: "address-change",
      category: "address",
      severity: "info",
      title: "Registered office changed in the last 36 months",
      detail: `${moves[0].line} from ${moves[0].effectiveFrom}.`,
      evidence: [{ ref: `address:${moves[0].id}`, type: "address", label: `Address from ${moves[0].effectiveFrom}` }],
    });
  }

  // 9. Dormancy / low activity indicators
  if (latestFin) {
    const rev = latestFin.metrics.revenue.value;
    if (rev !== null && rev <= 0) {
      out.push({
        id: "activity-no-revenue",
        category: "activity",
        severity: "review",
        title: `No revenue from operations reported for FY ${latestFin.financialYear}`,
        detail: "Reported revenue from operations is nil. Possible dormant/low-activity indicator — data point requiring further verification.",
        evidence: [refs.fin(latestFin.financialYear, latestFin.id)],
      });
    }
    const pat = input.financials!.years.slice(-3).map((y) => y.metrics.profitAfterTax.value);
    if (pat.length === 3 && pat.every((p) => p !== null && p < 0)) {
      out.push({
        id: "activity-losses",
        category: "activity",
        severity: "info",
        title: "Losses reported in each of the last three available years",
        detail: `Profit after tax: ${input.financials!.years.slice(-3).map((y) => `FY ${y.financialYear} ${fmtInr(y.metrics.profitAfterTax.value)}`).join(", ")}.`,
        evidence: input.financials!.years.slice(-3).map((y) => refs.fin(y.financialYear, y.id)),
      });
    }
    const nw = latestFin.metrics.netWorth.value;
    if (nw !== null && nw < 0) {
      out.push({
        id: "activity-negative-networth",
        category: "activity",
        severity: "attention",
        title: `Negative net worth reported for FY ${latestFin.financialYear}`,
        detail: `Reported net worth ${fmtInr(nw)}.`,
        evidence: [refs.fin(latestFin.financialYear, latestFin.id)],
      });
    }
  }
  if (input.filings && input.filings.length && ACTIVE_RE.test(profile.status ?? "")) {
    const lastFiled = input.filings.map((f) => f.filingDate).filter(Boolean).sort().at(-1) ?? null;
    if (lastFiled && monthsAgo(now, lastFiled) > 24) {
      out.push({
        id: "activity-no-recent-filings",
        category: "activity",
        severity: "review",
        title: "No filings in the last 24 months in available data",
        detail: `Most recent filing on record: ${lastFiled}. Possible inactivity indicator — data point requiring further verification.`,
        evidence: [refs.profile("filings", "Filing records for entity")],
      });
    }
  }

  // 10. Network connections to inactive entities
  const inactiveRelated = input.related.filter((r) => r.status && INACTIVE_RE.test(r.status));
  if (inactiveRelated.length) {
    out.push({
      id: "network-inactive-related",
      category: "network",
      severity: "info",
      title: `Directors/partners also linked to ${inactiveRelated.length} inactive or struck-off entit${inactiveRelated.length > 1 ? "ies" : "y"}`,
      detail: inactiveRelated.map((r) => `${r.viaName} → ${r.name} (${r.status})`).join("; ") + ". Related-entity connection only; it does not imply any issue with this entity.",
      evidence: inactiveRelated.map(refs.entity),
    });
  }

  // Data availability notes
  if (!input.financials || input.financials.years.length === 0) {
    out.push({
      id: "financials-unavailable",
      category: "data_availability",
      severity: "info",
      title: "Structured financial statements not available",
      detail: "No structured financial data is available from configured sources; financial checks were not performed.",
      evidence: [refs.profile("financials", "Financial records for entity")],
    });
  }
  if (!input.directors) {
    out.push({
      id: "directors-unavailable",
      category: "data_availability",
      severity: "info",
      title: "Director records not available from configured sources",
      detail: "Director-based checks were not performed.",
      evidence: [refs.profile("directors", "Director records")],
    });
  }

  const order = { attention: 0, review: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
