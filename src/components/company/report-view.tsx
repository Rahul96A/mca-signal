"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, FileText, Link2, Printer, RefreshCw } from "lucide-react";
import { api } from "@/lib/client/api-client";
import type { CompanyReport } from "@/lib/domain/types";
import { formatDateTime } from "@/lib/format";
import { Badge, Button, Card, CardContent } from "../ui/primitives";
import { SourceBadge } from "../badges";
import { ErrorState, LoadingBlock } from "../states";

export function ReportView({ identifier }: { identifier: string }) {
  const share = useSearchParams().get("share");
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const key = ["report", identifier, share];
  const q = useQuery({
    queryKey: key,
    queryFn: async () => (await api<CompanyReport>(share ? `/api/reports/${encodeURIComponent(share)}` : `/api/companies/${encodeURIComponent(identifier)}/report`)).data,
  });
  const regen = useMutation({
    mutationFn: async () => (await api<CompanyReport>(`/api/companies/${encodeURIComponent(identifier)}/report`, { method: "POST" })).data,
    onSuccess: (r) => qc.setQueryData(key, r),
  });

  if (q.isLoading) return <LoadingBlock rows={12} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data!;
  const refIndex = Object.keys(r.references);
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/company/${encodeURIComponent(identifier)}/report?share=${r.shareToken}` : "";

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4 no-print">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <SourceBadge category="ai_derived" />
          <Badge tone={r.generator === "openai" ? "info" : "neutral"}>
            <Bot className="size-3" /> {r.generator === "openai" ? `LLM narrative (${r.model})` : "Rule-based narrative (no LLM key configured)"}
          </Badge>
          {r.dataMode === "demo" && <SourceBadge category="demo" />}
          <span className="text-muted-foreground">Generated {formatDateTime(r.generatedAt)}</span>
          {share && <Badge tone="primary">Shared snapshot</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard?.writeText(shareUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check /> : <Link2 />} {copied ? "Copied" : "Copy share link"}
          </Button>
          {!share && (
            <Button variant="outline" size="sm" onClick={() => regen.mutate()} disabled={regen.isPending}>
              <RefreshCw className={regen.isPending ? "animate-spin" : ""} /> Regenerate
            </Button>
          )}
          <a href={`/api/companies/${encodeURIComponent(identifier)}/export?format=pdf`}>
            <Button size="sm"><FileText /> PDF</Button>
          </a>
          <Button variant="ghost" size="sm" onClick={() => window.print()}><Printer /> Print</Button>
        </div>
      </Card>

      <Card>
        <CardContent className="space-y-7 p-6 sm:p-8">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Company intelligence report</p>
            <h2 className="mt-1 text-xl font-semibold">{r.entityName}</h2>
            <p className="font-mono text-xs text-muted-foreground">{r.entityIdentifier}</p>
            <p className="mt-3 rounded-md border border-info/30 bg-info/5 p-3 text-xs leading-relaxed text-muted-foreground">
              Every statement below cites the underlying data record(s) as numbered references. Narrative text is <strong>AI-Derived Analysis</strong>; verify against the cited records and official MCA sources before relying on it.
            </p>
          </div>
          {r.sections.map((s) => (
            <section key={s.key} className="space-y-2.5" aria-labelledby={`sec-${s.key}`}>
              <h3 id={`sec-${s.key}`} className="text-base font-semibold text-primary">{s.title}</h3>
              {s.paragraphs.map((p, i) => (
                <p key={i} className="text-sm leading-relaxed">
                  {p.text}{" "}
                  {p.citations.map((c) => {
                    const n = refIndex.indexOf(c) + 1;
                    return n > 0 ? (
                      <a key={c} href={`#ref-${n}`} className="ml-0.5 align-super text-[10px] font-medium text-primary hover:underline" title={r.references[c]?.label}>
                        [{n}]
                      </a>
                    ) : null;
                  })}
                </p>
              ))}
            </section>
          ))}
          <section className="border-t pt-5">
            <h3 className="mb-2 text-sm font-semibold">Record references</h3>
            <ol className="grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
              {refIndex.map((ref, i) => (
                <li key={ref} id={`ref-${i + 1}`} className="scroll-mt-20">
                  <span className="font-mono text-foreground">[{i + 1}]</span> {r.references[ref].label} <span className="opacity-60">({r.references[ref].type.replace("_", " ")})</span>
                </li>
              ))}
            </ol>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
