"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, FileSearch, List, Rows3 } from "lucide-react";
import { useCompanyQuery } from "./use-company";
import type { Filing } from "@/lib/domain/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, CardContent, Select, Table, TBody, TD, TH, THead, TR } from "../ui/primitives";
import { SourceBadge } from "../badges";
import { EmptyState, ErrorState, LoadingBlock } from "../states";

interface FilingsPayload {
  available: boolean;
  items: Filing[];
  formTypes: string[];
  financialYears: string[];
  keyForms: string[];
  stats: { total: number; delayed: number; byForm: Record<string, number> };
}

const MCA_VPD = "https://www.mca.gov.in/content/mca/global/en/mca/document-related-services/view-public-documents-v3.html";

function DocumentAction({ f }: { f: Filing }) {
  if (f.documentUrl)
    return (
      <a href={f.documentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
        Download <ExternalLink className="size-3" />
      </a>
    );
  if (f.documentAvailable)
    return (
      <a href={MCA_VPD} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" title="Official documents are available via MCA View Public Documents (login and fee required)">
        MCA VPD <ExternalLink className="size-3" />
      </a>
    );
  return <span className="text-xs text-muted-foreground">Not available</span>;
}

function DelayBadge({ f }: { f: Filing }) {
  if (!f.dueDate || !f.filingDate) return null;
  if ((f.delayDays ?? 0) > 0)
    return (
      <Badge tone="warning" title={`Filing appears delayed based on available dates. Due ${f.dueDate} (${f.dueDateBasis === "statutory_estimate" ? "statutory estimate — extensions may apply" : "provided by source"})`}>
        +{f.delayDays} days
      </Badge>
    );
  return <Badge tone="success" title={`Due ${f.dueDate}`}>On time</Badge>;
}

export function FilingsView({ identifier }: { identifier: string }) {
  const [page, setPage] = useState(1);
  const [formType, setFormType] = useState("");
  const [year, setYear] = useState("");
  const [delayedOnly, setDelayedOnly] = useState(false);
  const [view, setView] = useState<"timeline" | "table">("timeline");
  const pageSize = 20;
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...(formType && { formType }), ...(year && { year }), ...(delayedOnly && { delayedOnly: "1" }) });
  const q = useCompanyQuery<FilingsPayload>(identifier, `/filings?${qs}`);

  if (q.isLoading && !q.data) return <LoadingBlock rows={8} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!.data;
  const total = q.data!.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (!d.available) return <EmptyState icon={FileSearch} title="Filing history not available" description="The configured data sources do not provide filing records for this entity (data.gov.in master data contains no filings)." />;

  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  // group timeline by year
  const groups = new Map<string, Filing[]>();
  for (const f of d.items) {
    const y = f.filingDate?.slice(0, 4) ?? "Undated";
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y)!.push(f);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4"><p className="text-[11px] uppercase text-muted-foreground">Total filings</p><p className="text-lg font-semibold tabular">{d.stats.total}</p></Card>
        <Card className="p-4"><p className="text-[11px] uppercase text-muted-foreground">Appear delayed</p><p className="text-lg font-semibold tabular">{d.stats.delayed}</p></Card>
        <Card className="col-span-2 p-4">
          <p className="mb-1.5 text-[11px] uppercase text-muted-foreground">Key forms on record</p>
          <div className="flex flex-wrap gap-1">
            {d.keyForms.map((k) => (
              <Badge key={k} tone={d.stats.byForm[k] ? "primary" : "neutral"} className={cn(!d.stats.byForm[k] && "opacity-50")}>
                {k} {d.stats.byForm[k] ? `×${d.stats.byForm[k]}` : ""}
              </Badge>
            ))}
          </div>
        </Card>
      </div>

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <Select value={formType} onChange={(e) => reset(() => setFormType(e.target.value))} aria-label="Form type">
          <option value="">All forms</option>
          {d.formTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Select value={year} onChange={(e) => reset(() => setYear(e.target.value))} aria-label="Financial year">
          <option value="">All years</option>
          {d.financialYears.map((y) => <option key={y} value={y}>FY {y}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={delayedOnly} onChange={(e) => reset(() => setDelayedOnly(e.target.checked))} /> Delayed only
        </label>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant={view === "timeline" ? "secondary" : "ghost"} onClick={() => setView("timeline")}><Rows3 /> Timeline</Button>
          <Button size="sm" variant={view === "table" ? "secondary" : "ghost"} onClick={() => setView("table")}><List /> Table</Button>
        </div>
      </Card>

      {d.items.length === 0 ? (
        <EmptyState title="No filings match these filters" />
      ) : view === "timeline" ? (
        <Card className="p-5">
          <ol className="space-y-6">
            {[...groups.entries()].map(([y, fs]) => (
              <li key={y}>
                <p className="mb-2 text-xs font-semibold text-muted-foreground">{y}</p>
                <ol className="relative space-y-3 border-l pl-5">
                  {fs.map((f) => (
                    <li key={f.id} className="relative">
                      <span className={cn("absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-card", (f.delayDays ?? 0) > 0 ? "bg-warning" : "bg-primary")} />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{f.formType}</span>
                        <span className="text-xs text-muted-foreground">{f.formDescription}</span>
                        {f.financialYear && <Badge>FY {f.financialYear}</Badge>}
                        <DelayBadge f={f} />
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>Filed {formatDate(f.filingDate)}</span>
                        {f.eventDate && <span>Event {formatDate(f.eventDate)}</span>}
                        {f.srn && <span className="font-mono">SRN {f.srn}</span>}
                        <span>{f.status}</span>
                        <DocumentAction f={f} />
                        <SourceBadge category={f.provenance.sourceCategory} short title={f.provenance.sourceName} />
                      </div>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Filing date</TH><TH>FY</TH><TH>Form</TH><TH>Description</TH><TH>Status</TH><TH>Timeliness</TH><TH>Document</TH><TH>Source</TH>
                </TR>
              </THead>
              <TBody>
                {d.items.map((f) => (
                  <TR key={f.id}>
                    <TD className="whitespace-nowrap tabular">{formatDate(f.filingDate)}</TD>
                    <TD className="whitespace-nowrap">{f.financialYear ?? "—"}</TD>
                    <TD className="whitespace-nowrap font-medium">{f.formType}</TD>
                    <TD className="min-w-48 text-xs text-muted-foreground">{f.formDescription}</TD>
                    <TD className="text-xs">{f.status}</TD>
                    <TD><DelayBadge f={f} /></TD>
                    <TD><DocumentAction f={f} /></TD>
                    <TD><SourceBadge category={f.provenance.sourceCategory} short title={f.provenance.sourceName} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "0 results"} · Due dates marked as estimates follow statutory timelines and may not reflect extensions.
        </span>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft /></Button>
          <span className="px-2 py-1.5">{page} / {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight /></Button>
        </div>
      </div>
    </div>
  );
}
