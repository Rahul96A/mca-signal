/** CSV and PDF exports built from the same dossier / report the UI shows. */
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { METRIC_KEYS } from "../domain/types";
import { METRIC_LABELS } from "../analysis/financials";
import type { CompanyReport } from "../domain/types";
import type { Dossier } from "./entity-service";
import { ValidationError } from "./errors";

export const CSV_SECTIONS = ["filings", "financials", "charges", "directors", "signals", "network"] as const;
export type CsvSection = (typeof CSV_SECTIONS)[number];

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    let s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\r\n");
}

export function sectionCsv(d: Dossier, section: string): string {
  const src = (p: { sourceName: string; sourceCategory: string; fetchedAt: string | null }) => ({ source: p.sourceName, source_category: p.sourceCategory, fetched_at: p.fetchedAt });
  switch (section as CsvSection) {
    case "filings":
      return toCsv((d.filings ?? []).map((f) => ({
        filing_date: f.filingDate, financial_year: f.financialYear, form_type: f.formType, form_description: f.formDescription, status: f.status,
        srn: f.srn, due_date: f.dueDate, due_date_basis: f.dueDateBasis, delay_days: f.delayDays, document_available: f.documentAvailable, ...src(f.provenance),
      })));
    case "financials":
      return toCsv((d.financials?.years ?? []).flatMap((y) =>
        METRIC_KEYS.map((k) => ({ financial_year: y.financialYear, metric: METRIC_LABELS[k], value_inr: y.metrics[k].value, basis: y.metrics[k].basis ?? "not available", formula: y.metrics[k].formula ?? "", yoy_change: d.financials!.yoy[y.financialYear]?.[k] ?? "", ...src(y.provenance) })),
      ));
    case "charges":
      return toCsv((d.charges ?? []).map((c) => ({
        charge_id: c.chargeId, holder: c.holderName, amount_inr: c.amount, creation_date: c.creationDate, modification_date: c.modificationDate,
        satisfaction_date: c.satisfactionDate, status: c.status, property: c.propertyDescription, ...src(c.provenance),
      })));
    case "directors":
      return toCsv((d.directors ?? []).map((r) => ({ name: r.name, din: r.din, designation: r.designation, appointment_date: r.appointmentDate, cessation_date: r.cessationDate, current: r.isCurrent, ...src(r.provenance) })));
    case "signals":
      return toCsv(d.signals.map((s) => ({ severity: s.severity, category: s.category, title: s.title, detail: s.detail, evidence: s.evidence.map((e) => e.label).join(" | "), basis: "AI-Derived Analysis (rule-based)" })));
    case "network":
      return toCsv(d.related.map((e) => ({ related_entity: e.name, identifier: e.identifier, kind: e.kind, status: e.status, via_director: e.viaName, via_din: e.viaDin })));
    default:
      throw new ValidationError(`Unknown CSV section. Use one of: ${CSV_SECTIONS.join(", ")}`);
  }
}

const inr = (v: number | null) => (v === null ? "—" : `₹${(v / 1e7).toFixed(2)} Cr`.replace("₹", "Rs "));
const ascii = (s: string) => s.replace(/₹/g, "Rs ").replace(/[–—]/g, "-").replace(/[→]/g, "->").replace(/[×]/g, "x").replace(/[−]/g, "-").replace(/[^\x20-\x7E\n]/g, "");

/** Server-side PDF of the full report (jsPDF core fonts are Latin-1, so text is ASCII-normalised). */
export function reportPdf(d: Dossier, report: CompanyReport): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = M;
  const line = (text: string, size = 10, style: "normal" | "bold" = "normal", color: [number, number, number] = [30, 30, 30]) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    for (const l of doc.splitTextToSize(ascii(text), W - 2 * M) as string[]) {
      if (y > doc.internal.pageSize.getHeight() - M) {
        doc.addPage();
        y = M;
      }
      doc.text(l, M, y);
      y += size * 1.35;
    }
  };

  const p = d.profile;
  line("MCA Signal — Company Intelligence Report", 9, "normal", [100, 100, 100]);
  line(p.name, 18, "bold");
  line(`${p.kind === "llp" ? "LLPIN" : "CIN"}: ${p.identifier}   Status: ${p.status ?? "n/a"}   Generated: ${report.generatedAt.slice(0, 16).replace("T", " ")} UTC`, 9, "normal", [90, 90, 90]);
  const badge = d.dataMode === "demo" || p.provenance.sourceCategory === "demo" ? "DEMO DATA - fictional entity" : `Source: ${p.provenance.sourceName}`;
  line(`${badge}   |   Narrative: ${report.generator === "openai" ? `AI-Derived Analysis (${report.model})` : "Automated rule-based analysis"}`, 9, "bold", [160, 60, 20]);
  y += 6;

  autoTable(doc, {
    startY: y,
    theme: "grid",
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 58, 95] },
    head: [["Field", "Value"]],
    body: [
      ["Type / class", `${p.companyClass ?? "-"} / ${p.category ?? "-"}`],
      ["Incorporated", `${p.incorporationDate ?? "-"} (${p.ageYears ?? "-"} yrs)`],
      ["ROC / State", `${p.roc ?? "-"} / ${p.state ?? "-"}`],
      ["Industry", `${p.industry ?? "-"}${p.principalActivity ? ` - ${p.principalActivity}` : ""}`],
      p.kind === "company" ? ["Authorised / Paid-up capital", `${inr(p.authorizedCapital)} / ${inr(p.paidUpCapital)}`] : ["Contribution", inr(p.totalContribution)],
      ["Registered office", p.registeredOffice ? `${p.registeredOffice.line}, ${p.registeredOffice.city ?? ""} ${p.registeredOffice.pincode ?? ""}` : "-"],
    ].map((r) => r.map(ascii)),
    margin: { left: M, right: M },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 16;

  if (d.financials?.years.length) {
    const ys = d.financials.years.slice(-5);
    autoTable(doc, {
      startY: y,
      theme: "striped",
      styles: { fontSize: 7.5 },
      headStyles: { fillColor: [30, 58, 95] },
      head: [["Metric (Rs Cr)", ...ys.map((x) => `FY ${x.financialYear}`)]],
      body: (["revenue", "profitAfterTax", "ebitda", "netWorth", "totalAssets", "totalLiabilities", "borrowings"] as const).map((k) => [
        METRIC_LABELS[k],
        ...ys.map((x) => (x.metrics[k].value === null ? "n/a" : `${(x.metrics[k].value! / 1e7).toFixed(2)}${x.metrics[k].basis === "calculated" ? " (C)" : ""}`)),
      ]),
      margin: { left: M, right: M },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 6;
    line("(C) = calculated from reported values. All other values are as reported. Missing values are not estimated.", 7, "normal", [110, 110, 110]);
    y += 8;
  }

  const refIndex = Object.keys(report.references);
  for (const s of report.sections) {
    y += 4;
    line(s.title, 12, "bold", [30, 58, 95]);
    for (const para of s.paragraphs) {
      const nums = para.citations.map((c) => refIndex.indexOf(c) + 1).filter((n) => n > 0);
      line(`${para.text}${nums.length ? `  [${nums.join(", ")}]` : ""}`, 9);
      y += 3;
    }
  }
  y += 6;
  line("Record references", 11, "bold", [30, 58, 95]);
  refIndex.forEach((r, i) => line(`[${i + 1}] ${report.references[r].label}  (${r.split(":")[0]})`, 7, "normal", [80, 80, 80]));

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(130, 130, 130);
    doc.text(ascii(`MCA Signal - ${p.identifier} - page ${i} of ${pages} - not legal or financial advice`), M, doc.internal.pageSize.getHeight() - 20);
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
