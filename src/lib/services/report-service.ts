/**
 * Company intelligence report.
 *
 * 1. Build a FACT BASE from the dossier: every fact has a stable ref ("filing:<id>", "fin:<id>", …)
 *    pointing at a stored record.
 * 2. Generate narrative sections 1–9 either with OpenAI (when OPENAI_API_KEY is set) or with a
 *    deterministic rule-based writer. Sections 10–12 (sources, freshness, limitations) are always
 *    deterministic.
 * 3. VALIDATE: every paragraph must cite ≥1 ref that exists in the fact base; invalid citations are
 *    removed and uncited paragraphs dropped. If the LLM output is unusable we fall back to rules.
 */
import { randomBytes } from "node:crypto";
import { config } from "../config";
import { getDb } from "../db/client";
import { hashPayload } from "../db/persist";
import { fetchWithRetry } from "../http";
import { logger, errorMessage } from "../logger";
import type { CompanyReport, RecordRef, ReportParagraph, ReportSection } from "../domain/types";
import { fmtInr, refs } from "../analysis/risk";
import { METRIC_LABELS } from "../analysis/financials";
import { getDossier, parseEntityIdentifier, type Dossier } from "./entity-service";
import { NotFoundError } from "./errors";

export interface Fact {
  ref: string;
  statement: string;
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(1)}%`);
const CATEGORY_LABEL = { official_government: "Official Government Data", third_party: "Third-Party Aggregated Data", demo: "Demo Data", ai_derived: "AI-Derived Analysis" };

export function buildFactBase(d: Dossier): { facts: Fact[]; references: Record<string, RecordRef> } {
  const facts: Fact[] = [];
  const references: Record<string, RecordRef> = {};
  const add = (r: RecordRef, statement: string) => {
    references[r.ref] = r;
    facts.push({ ref: r.ref, statement });
  };
  const p = d.profile;
  add(refs.profile("name", "Entity name"), `Name: ${p.name}; ${p.kind === "llp" ? "LLPIN" : "CIN"}: ${p.identifier}`);
  add(refs.profile("status", `Status: ${p.status ?? "unknown"}`), `Registry status: ${p.status ?? "not available"}`);
  add(refs.profile("type", "Entity type"), `Type/class: ${p.companyClass ?? "n/a"}; category: ${p.category ?? "n/a"}; sub-category: ${p.subCategory ?? "n/a"}`);
  add(refs.profile("incorporation", "Incorporation date"), `Incorporated on ${p.incorporationDate ?? "n/a"} (${p.ageYears ?? "n/a"} years), ROC: ${p.roc ?? "n/a"}, state: ${p.state ?? "n/a"}`);
  add(refs.profile("industry", "Industry"), `Industry: ${p.industry ?? "n/a"}; principal activity: ${p.principalActivity ?? "n/a"}; NIC: ${p.nicCode ?? "n/a"}`);
  if (p.kind === "company") add(refs.profile("capital", "Share capital"), `Authorised capital ${fmtInr(p.authorizedCapital)}; paid-up capital ${fmtInr(p.paidUpCapital)}`);
  else add(refs.profile("capital", "Contribution"), `Total obligation of contribution ${fmtInr(p.totalContribution)}`);
  if (p.registeredOffice) add({ ref: `address:${p.registeredOffice.id}`, type: "address", label: "Registered office" }, `Registered office: ${p.registeredOffice.line}, ${p.registeredOffice.city ?? ""} ${p.registeredOffice.pincode ?? ""}`.trim());
  for (const a of p.addressHistory.filter((x) => x.id !== p.registeredOffice?.id)) {
    add({ ref: `address:${a.id}`, type: "address", label: `Previous address from ${a.effectiveFrom ?? "n/a"}` }, `Previous registered office ${a.line} (${a.effectiveFrom ?? "?"} to ${a.effectiveTo ?? "?"})`);
  }
  for (const n of p.nameHistory) add({ ref: `name:${n.id}`, type: "name_history", label: `Former name ${n.previousName}` }, `Former name "${n.previousName}", changed on ${n.changedOn ?? "n/a"}`);
  add(refs.profile("filings", "Filing records for entity"), `Filing records available: ${d.filings ? d.filings.length : "not provided by sources"}`);
  add(refs.profile("directors", "Director records"), `Director/partner records available: ${d.directors ? d.directors.length : "not provided by sources"}`);
  add(refs.profile("financials", "Financial records for entity"), `Financial years available: ${d.financials ? d.financials.years.length : "not provided by sources"}`);

  for (const r of d.directors ?? []) add(refs.role(r), `${r.name} (DIN ${r.din}), ${r.designation ?? "director"}, appointed ${r.appointmentDate ?? "n/a"}${r.cessationDate ? `, ceased ${r.cessationDate}` : ", currently serving"}`);
  for (const f of d.filings ?? []) {
    add(refs.filing(f), `${f.formType} (${f.formDescription ?? "form"})${f.financialYear ? ` for FY ${f.financialYear}` : ""} filed ${f.filingDate ?? "n/a"}${f.dueDate ? `, due ${f.dueDate} (${f.dueDateBasis === "statutory_estimate" ? "statutory estimate" : "provided"})` : ""}${f.delayDays ? `, ${f.delayDays} days after due date` : ""}`);
  }
  for (const y of d.financials?.years ?? []) {
    const m = y.metrics;
    const parts = (["revenue", "profitAfterTax", "ebitda", "netWorth", "totalAssets", "totalLiabilities", "borrowings"] as const)
      .filter((k) => m[k].value !== null)
      .map((k) => `${METRIC_LABELS[k]} ${fmtInr(m[k].value)} [${m[k].basis}]`);
    const yoy = d.financials!.yoy[y.financialYear];
    add(refs.fin(y.financialYear, y.id), `FY ${y.financialYear}: ${parts.join("; ")}${yoy?.revenue != null ? `; revenue YoY ${pct(yoy.revenue)} [derived]` : ""}`);
  }
  for (const c of d.charges ?? []) add(refs.charge(c), `Charge ${c.chargeId} in favour of ${c.holderName}, ${fmtInr(c.amount)}, created ${c.creationDate ?? "n/a"}${c.modificationDate ? `, modified ${c.modificationDate}` : ""}, status ${c.status}${c.satisfactionDate ? ` (satisfied ${c.satisfactionDate})` : ""}`);
  for (const e of d.related) add({ ref: `entity:${e.identifier}`, type: "related_entity", label: `${e.name} (${e.identifier})` }, `Related entity ${e.name} (${e.identifier}, status ${e.status ?? "n/a"}) via ${e.viaName} (DIN ${e.viaDin})`);
  return { facts, references };
}

// ─── Rule-based narrative ────────────────────────────────────────────────────
function entityDescription(kind: "company" | "llp", companyClass: string | null): string {
  if (kind === "llp") return "a limited liability partnership";
  switch ((companyClass ?? "").toLowerCase()) {
    case "private":
      return "a private limited company";
    case "public":
      return "a public limited company";
    case "one person company":
      return "a one person company";
    default:
      return companyClass ? `a company (class: ${companyClass})` : "a registered company";
  }
}

function ruleBasedSections(d: Dossier): ReportSection[] {
  const p = d.profile;
  const para = (text: string, citations: string[]): ReportParagraph => ({ text, citations });
  const fa = d.financials;
  const latest = fa?.latest ?? null;
  const current = (d.directors ?? []).filter((r) => r.isCurrent);
  const openCharges = (d.charges ?? []).filter((c) => c.status === "open");
  const attention = d.signals.filter((s) => s.severity !== "info");

  const exec: ReportParagraph[] = [
    para(
      `${p.name} (${p.identifier}) is ${entityDescription(p.kind, p.companyClass)} incorporated on ${p.incorporationDate ?? "an unknown date"} under ${p.roc ?? "an unspecified ROC"}, with registry status "${p.status ?? "unknown"}".`,
      ["profile:name", "profile:incorporation", "profile:status"],
    ),
  ];
  if (latest) {
    const rev = latest.metrics.revenue.value;
    const pat = latest.metrics.profitAfterTax.value;
    exec.push(para(`For FY ${latest.financialYear} it reported revenue of ${fmtInr(rev)} and profit/(loss) after tax of ${fmtInr(pat)}.`, [refs.fin(latest.financialYear, latest.id).ref]));
  }
  exec.push(
    para(
      attention.length
        ? `${attention.length} potential review item(s) were identified from available data: ${attention.map((s) => s.title.charAt(0).toLowerCase() + s.title.slice(1)).join("; ")}. These are observations requiring verification, not conclusions.`
        : "No potential review items rated above informational were identified from available data.",
      attention.length ? [...new Set(attention.flatMap((s) => s.evidence.map((e) => e.ref)))].slice(0, 12) : ["profile:status"],
    ),
  );

  const overview: ReportParagraph[] = [
    para(`Industry: ${p.industry ?? "not available"}${p.principalActivity ? ` — ${p.principalActivity}` : ""}${p.nicCode ? ` (NIC ${p.nicCode})` : ""}.`, ["profile:industry"]),
    p.kind === "company"
      ? para(`Authorised capital is ${fmtInr(p.authorizedCapital)} and paid-up capital is ${fmtInr(p.paidUpCapital)}. Category: ${p.category ?? "n/a"}; sub-category: ${p.subCategory ?? "n/a"}.`, ["profile:capital", "profile:type"])
      : para(`Total obligation of contribution is ${fmtInr(p.totalContribution)}.`, ["profile:capital"]),
  ];
  if (p.registeredOffice) overview.push(para(`The registered office is at ${p.registeredOffice.line}${p.registeredOffice.city ? `, ${p.registeredOffice.city}` : ""}${p.registeredOffice.pincode ? ` ${p.registeredOffice.pincode}` : ""}.`, [`address:${p.registeredOffice.id}`]));
  for (const n of p.nameHistory) overview.push(para(`The entity was previously named "${n.previousName}" (changed ${n.changedOn ?? "on an unknown date"}).`, [`name:${n.id}`]));

  const people: ReportParagraph[] = d.directors
    ? [
        para(
          current.length
            ? `${current.length} current ${p.kind === "llp" ? "designated partner(s)" : "director(s)"}: ${current.map((r) => `${r.name} (${r.designation ?? "Director"}, since ${r.appointmentDate ?? "n/a"})`).join(", ")}.`
            : "No currently serving directors are recorded in the available data.",
          current.length ? current.map((r) => refs.role(r).ref) : ["profile:directors"],
        ),
        ...(() => {
          const former = (d.directors ?? []).filter((r) => !r.isCurrent);
          return former.length ? [para(`Former: ${former.map((r) => `${r.name} (${r.appointmentDate ?? "?"} – ${r.cessationDate})`).join(", ")}.`, former.map((r) => refs.role(r).ref))] : [];
        })(),
        para("Shareholding / beneficial ownership data is not part of the configured datasets and is not reported here.", ["profile:directors"]),
      ]
    : [para("Director records are not available from the configured data sources.", ["profile:directors"])];

  const fin: ReportParagraph[] = [];
  if (fa && fa.years.length) {
    fin.push(para(`Structured financial data is available for ${fa.years.length} year(s), FY ${fa.coverage.firstYear} to FY ${fa.coverage.lastYear}.`, fa.years.map((y) => refs.fin(y.financialYear, y.id).ref)));
    for (const y of fa.years.slice(-3)) {
      const m = y.metrics;
      const r = fa.ratios[y.financialYear];
      fin.push(
        para(
          `FY ${y.financialYear}: revenue ${fmtInr(m.revenue.value)}, PAT ${fmtInr(m.profitAfterTax.value)}, EBITDA ${m.ebitda.value === null ? "not derivable" : `${fmtInr(m.ebitda.value)} (${m.ebitda.basis})`}, net worth ${fmtInr(m.netWorth.value)}, total liabilities ${fmtInr(m.totalLiabilities.value)}${m.totalLiabilities.basis === "calculated" ? " (calculated)" : ""}, borrowings ${fmtInr(m.borrowings.value)}${r?.patMargin != null ? `; PAT margin ${pct(r.patMargin)} (derived)` : ""}.`,
          [refs.fin(y.financialYear, y.id).ref],
        ),
      );
    }
    const c = fa.cagr.filter((x) => x.metric === "revenue" && x.value !== null);
    if (c.length) {
      const startRefs = fa.years.filter((y) => c.some((x) => x.from === y.financialYear || x.to === y.financialYear)).map((y) => refs.fin(y.financialYear, y.id).ref);
      fin.push(para(`Revenue CAGR (derived): ${c.map((x) => `${x.span}-year ${pct(x.value)} (FY ${x.from} → FY ${x.to})`).join("; ")}.`, startRefs));
    }
  } else {
    fin.push(para("No structured financial statements are available from the configured sources. No financial figures have been estimated.", ["profile:financials"]));
  }

  const filingsP: ReportParagraph[] = [];
  if (d.filings) {
    const annual = d.filings.filter((f) => ["AOC-4", "MGT-7", "MGT-7A", "LLP Form 8", "LLP Form 11"].includes(f.formType));
    const delayed = d.filings.filter((f) => (f.delayDays ?? 0) > 0);
    filingsP.push(para(`${d.filings.length} filing record(s) are available, including ${annual.length} annual filing(s). The most recent filing is ${d.filings[0] ? `${d.filings[0].formType} on ${d.filings[0].filingDate}` : "n/a"}.`, d.filings[0] ? [refs.filing(d.filings[0]).ref] : ["profile:filings"]));
    if (delayed.length) filingsP.push(para(`${delayed.length} filing(s) appear delayed based on available dates (e.g. ${delayed.slice(0, 3).map((f) => `${f.formType} FY ${f.financialYear ?? "—"}, ${f.delayDays} days`).join("; ")}).`, delayed.map((f) => refs.filing(f).ref)));
    const missing = d.signals.find((s) => s.id === "filings-missing");
    if (missing) filingsP.push(para(missing.detail, missing.evidence.map((e) => e.ref)));
  } else filingsP.push(para("Filing history is not available from the configured data sources.", ["profile:filings"]));

  const chargesP: ReportParagraph[] = [];
  if (d.charges) {
    if (!d.charges.length) chargesP.push(para("No registered charges are recorded in the available data.", ["profile:filings"]));
    else {
      chargesP.push(para(`${d.charges.length} charge(s) recorded: ${openCharges.length} open (total ${fmtInr(openCharges.reduce((a, c) => a + (c.amount ?? 0), 0))}) and ${d.charges.length - openCharges.length} satisfied. Charge amounts reflect sanctioned/secured amounts, not outstanding balances.`, d.charges.map((c) => refs.charge(c).ref)));
      for (const c of openCharges) chargesP.push(para(`Open: ${c.holderName} — ${fmtInr(c.amount)}, created ${c.creationDate}${c.modificationDate ? `, modified ${c.modificationDate}` : ""}${c.propertyDescription ? ` (${c.propertyDescription})` : ""}.`, [refs.charge(c).ref]));
    }
  } else chargesP.push(para("Charge data is not available from the configured data sources.", ["profile:filings"]));

  const net: ReportParagraph[] = d.related.length
    ? [
        para(`Directors/partners of this entity are also associated with ${d.related.length} other entit${d.related.length > 1 ? "ies" : "y"}: ${d.related.map((e) => `${e.name} (${e.status ?? "status n/a"}) via ${e.viaName}`).join("; ")}.`, d.related.map((e) => `entity:${e.identifier}`)),
      ]
    : [para("No connections to other entities were found through directors/partners in the available data.", ["profile:directors"])];

  const changes: ReportParagraph[] = d.signals
    .filter((s) => ["directors", "address", "capital", "charges"].includes(s.category))
    .map((s) => para(`${s.title}. ${s.detail}`, s.evidence.map((e) => e.ref)));
  if (!changes.length) changes.push(para("No significant director, address, capital or charge changes were detected in the available data.", ["profile:status"]));

  const dd: ReportParagraph[] = d.signals.map((s) => para(`[${s.severity === "attention" ? "Potential review item — priority" : s.severity === "review" ? "Potential review item" : "Information"}] ${s.title}. ${s.detail}`, s.evidence.map((e) => e.ref)));
  if (!dd.length) dd.push(para("No due-diligence signals were generated from available data.", ["profile:status"]));

  return [
    { key: "executive_summary", title: "1. Executive Summary", paragraphs: exec },
    { key: "company_overview", title: "2. Company Overview", paragraphs: overview },
    { key: "ownership_directors", title: "3. Ownership / Director Overview", paragraphs: people },
    { key: "financial_overview", title: "4. Financial Overview", paragraphs: fin },
    { key: "filing_history", title: "5. Filing History", paragraphs: filingsP },
    { key: "charges_liabilities", title: "6. Charges & Liabilities", paragraphs: chargesP },
    { key: "network", title: "7. Director / Company Network", paragraphs: net },
    { key: "important_changes", title: "8. Important Changes", paragraphs: changes },
    { key: "due_diligence", title: "9. Potential Due-Diligence Items", paragraphs: dd },
  ];
}

function fixedSections(d: Dossier, generator: "openai" | "rule_based"): ReportSection[] {
  const p = d.profile;
  const src: ReportParagraph[] = d.sources.map((s) => ({
    text: `${s.name} — ${CATEGORY_LABEL[s.category]}. ${s.description ?? ""} Licence: ${s.license ?? "n/a"}.${s.publishedAt ? ` Dataset published/updated: ${s.publishedAt.slice(0, 10)}.` : ""}`,
    citations: ["profile:name"],
  }));
  src.push({
    text: generator === "openai" ? `Narrative sections 1–9 are AI-Derived Analysis generated by ${config.openaiModel} from the cited records only.` : "Narrative sections 1–9 are automated rule-based analysis generated from the cited records (no language model was used).",
    citations: ["profile:name"],
  });
  const fresh: ReportParagraph[] = [
    {
      text: `Entity master record fetched ${p.provenance.fetchedAt?.slice(0, 19).replace("T", " ") ?? "n/a"} UTC from "${p.provenance.sourceName}"${p.provenance.lastUpdatedAt ? `; source last updated ${p.provenance.lastUpdatedAt.slice(0, 10)}` : ""}. Oldest record in this report fetched ${d.quality.oldestFetchAt?.slice(0, 10) ?? "n/a"}; newest ${d.quality.freshestFetchAt?.slice(0, 10) ?? "n/a"}. Data completeness score: ${d.quality.score}/100.`,
      citations: ["profile:name"],
    },
  ];
  const lim: ReportParagraph[] = [
    { text: "This report is generated from structured records available to the configured data sources and may be incomplete or out of date. It is not legal, financial or credit advice.", citations: ["profile:name"] },
    { text: "Filing delays are computed against provided or statutory-estimate due dates; AGM extensions, condonation schemes and MCA relaxation circulars are not accounted for.", citations: ["profile:filings"] },
    { text: "Charge amounts are amounts secured at registration/modification, not outstanding balances. Director connections indicate shared appointments only and imply no relationship beyond that.", citations: ["profile:directors"] },
    { text: "Official MCA documents (financial statements, annual returns) must be obtained from the MCA View Public Documents service, which requires login and fees; this application does not download or bypass access to them.", citations: ["profile:filings"] },
  ];
  if (d.dataMode === "demo" || p.provenance.sourceCategory === "demo") lim.unshift({ text: "DEMO DATA: this entity and all related records are fictional and exist only to demonstrate the application.", citations: ["profile:name"] });
  return [
    { key: "data_sources", title: "10. Data Sources", paragraphs: src },
    { key: "data_freshness", title: "11. Data Freshness", paragraphs: fresh },
    { key: "limitations", title: "12. Limitations", paragraphs: lim },
  ];
}

// ─── OpenAI narrative ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You write neutral due-diligence reports about Indian companies/LLPs from a list of FACTS.
Rules:
- Use ONLY the facts provided. Never invent numbers, dates, names or events. If data is missing, say it is not available.
- Every paragraph MUST end with citations: include the "ref" values of the facts it relies on in the "citations" array.
- Neutral wording only. Never accuse. Use phrases like "Potential review item", "Data point requiring further verification", "Filing appears delayed based on available dates".
- Values tagged [calculated] or [derived] must be described as calculated/derived.
Return JSON: {"sections":[{"key":string,"paragraphs":[{"text":string,"citations":[string]}]}]} with keys in this order:
executive_summary, company_overview, ownership_directors, financial_overview, filing_history, charges_liabilities, network, important_changes, due_diligence.`;

export function validateSections(raw: unknown, references: Record<string, RecordRef>, titles: Record<string, string>): ReportSection[] {
  const out: ReportSection[] = [];
  const sections = (raw as { sections?: unknown[] })?.sections;
  if (!Array.isArray(sections)) return out;
  for (const s of sections) {
    const sec = s as { key?: string; paragraphs?: Array<{ text?: unknown; citations?: unknown }> };
    if (!sec.key || !titles[sec.key] || !Array.isArray(sec.paragraphs)) continue;
    const paragraphs: ReportParagraph[] = [];
    for (const p of sec.paragraphs) {
      if (typeof p?.text !== "string" || !p.text.trim()) continue;
      const cites = Array.isArray(p.citations) ? p.citations.filter((c): c is string => typeof c === "string" && c in references) : [];
      if (!cites.length) continue; // uncited claims are dropped
      paragraphs.push({ text: p.text.trim(), citations: [...new Set(cites)] });
    }
    if (paragraphs.length) out.push({ key: sec.key, title: titles[sec.key], paragraphs });
  }
  return out;
}

async function openAiSections(d: Dossier, facts: Fact[], references: Record<string, RecordRef>, fallback: ReportSection[]): Promise<ReportSection[] | null> {
  const titles = Object.fromEntries(fallback.map((s) => [s.key, s.title]));
  const payload = {
    entity: `${d.profile.name} (${d.profile.identifier})`,
    facts,
    signals: d.signals.map((s) => ({ severity: s.severity, title: s.title, detail: s.detail, refs: s.evidence.map((e) => e.ref) })),
  };
  try {
    const res = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.openaiModel,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
      retries: 2,
      timeoutMs: 90_000,
    });
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return null;
    const valid = validateSections(JSON.parse(content), references, titles);
    if (valid.length < 6) {
      logger.warn("AI report failed validation; using rule-based report", { validSections: valid.length });
      return null;
    }
    // keep canonical order; fill any missing section from the rule-based version
    return fallback.map((f) => valid.find((v) => v.key === f.key) ?? f);
  } catch (e) {
    logger.error("OpenAI report generation failed", { error: errorMessage(e) });
    return null;
  }
}

function snapshotHash(d: Dossier) {
  return hashPayload({ p: d.profile, di: d.directors, f: d.filings, fi: d.financials?.years, c: d.charges, r: d.related, gen: config.openaiApiKey ? config.openaiModel : "rules" });
}

export async function generateReport(raw: string, opts: { userId?: string | null; forceNew?: boolean } = {}): Promise<CompanyReport> {
  const identifier = parseEntityIdentifier(raw);
  const d = await getDossier(identifier);
  const db = await getDb();
  const hash = snapshotHash(d);

  if (!opts.forceNew) {
    const existing = await db.query<{ content: CompanyReport }>(
      `select content from reports where entity_identifier = $1 and data_snapshot_hash = $2 order by created_at desc limit 1`,
      [identifier, hash],
    );
    if (existing[0]) return existing[0].content;
  }

  const { facts, references } = buildFactBase(d);
  const rules = ruleBasedSections(d);
  let generator: "openai" | "rule_based" = "rule_based";
  let narrative = rules;
  if (config.openaiApiKey) {
    const ai = await openAiSections(d, facts, references, rules);
    if (ai) {
      narrative = ai;
      generator = "openai";
    }
  }
  const report: CompanyReport = {
    id: "",
    entityIdentifier: identifier,
    entityName: d.profile.name,
    generatedAt: new Date().toISOString(),
    generator,
    model: generator === "openai" ? config.openaiModel : null,
    shareToken: randomBytes(12).toString("base64url"),
    sections: [...narrative, ...fixedSections(d, generator)],
    references,
    dataMode: d.dataMode,
  };
  const row = await db.query<{ id: string }>(
    `insert into reports (entity_kind, entity_identifier, generator, model, content, data_snapshot_hash, share_token, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [d.profile.kind, identifier, generator, report.model, JSON.stringify(report), hash, report.shareToken, opts.userId ?? null],
  );
  report.id = row[0].id;
  await db.query(`update reports set content = $2 where id = $1`, [report.id, JSON.stringify(report)]);
  return report;
}

export async function getReportByShareToken(token: string): Promise<CompanyReport> {
  const db = await getDb();
  const rows = await db.query<{ content: CompanyReport }>(`select content from reports where share_token = $1`, [token]);
  if (!rows[0]) throw new NotFoundError("Shared report not found");
  return rows[0].content;
}
