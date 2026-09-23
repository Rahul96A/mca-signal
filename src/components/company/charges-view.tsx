"use client";
import { useState } from "react";
import { Landmark } from "lucide-react";
import { useCompanyQuery } from "./use-company";
import type { Charge, MetricValue, RiskSignal } from "@/lib/domain/types";
import { formatDate, formatInr } from "@/lib/format";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from "../ui/primitives";
import { BasisBadge, SourceBadge } from "../badges";
import { EmptyState, ErrorState, LoadingBlock } from "../states";
import { SignalList } from "./signals";

interface ChargesPayload {
  available: boolean;
  charges: Charge[];
  summary: { open: number; satisfied: number; openAmount: number; satisfiedAmount: number; lenders: string[] };
  latestBorrowings: { financialYear: string; value: MetricValue; netWorth: MetricValue } | null;
  signals: RiskSignal[];
}

export function ChargesView({ identifier }: { identifier: string }) {
  const [filter, setFilter] = useState<"all" | "open" | "satisfied">("all");
  const q = useCompanyQuery<ChargesPayload>(identifier, "/charges");
  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!.data;
  if (!d.available) return <EmptyState icon={Landmark} title="Charge data not available" description="The configured data sources do not provide registered charge records for this entity." />;
  const rows = d.charges.filter((c) => filter === "all" || c.status === filter);
  const openShare = d.summary.openAmount + d.summary.satisfiedAmount > 0 ? d.summary.openAmount / (d.summary.openAmount + d.summary.satisfiedAmount) : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4"><p className="text-[11px] uppercase text-muted-foreground">Open charges</p><p className="text-lg font-semibold tabular">{d.summary.open}</p><p className="text-xs text-muted-foreground tabular">{formatInr(d.summary.openAmount)}</p></Card>
        <Card className="p-4"><p className="text-[11px] uppercase text-muted-foreground">Satisfied charges</p><p className="text-lg font-semibold tabular">{d.summary.satisfied}</p><p className="text-xs text-muted-foreground tabular">{formatInr(d.summary.satisfiedAmount)}</p></Card>
        <Card className="p-4">
          <p className="flex items-center gap-1 text-[11px] uppercase text-muted-foreground">Borrowings <BasisBadge basis={d.latestBorrowings?.value.basis ?? null} /></p>
          <p className="text-lg font-semibold tabular">{formatInr(d.latestBorrowings?.value.value ?? null)}</p>
          <p className="text-xs text-muted-foreground">{d.latestBorrowings ? `FY ${d.latestBorrowings.financialYear} (reported)` : "Not available"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] uppercase text-muted-foreground">Open lenders</p>
          <p className="text-lg font-semibold tabular">{d.summary.lenders.length}</p>
          <p className="truncate text-xs text-muted-foreground" title={d.summary.lenders.join(", ")}>{d.summary.lenders.join(", ") || "—"}</p>
        </Card>
      </div>

      {d.charges.length > 0 && (
        <Card className="p-4">
          <div className="mb-2 flex justify-between text-xs text-muted-foreground">
            <span>Open vs satisfied (by secured amount)</span>
            <span className="tabular">{Math.round(openShare * 100)}% open</span>
          </div>
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            <div className="rounded-l-full bg-[var(--chart-2)]" style={{ width: `${openShare * 100}%` }} title={`Open ${formatInr(d.summary.openAmount)}`} />
            <div className="flex-1 rounded-r-full bg-muted-foreground/30" title={`Satisfied ${formatInr(d.summary.satisfiedAmount)}`} />
          </div>
          <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[var(--chart-2)]" /> Open</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-muted-foreground/30" /> Satisfied</span>
          </div>
        </Card>
      )}

      {d.signals.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Charge-related signals</CardTitle></CardHeader>
          <CardContent><SignalList signals={d.signals} /></CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Registered charges</CardTitle>
            <CardDescription>Amounts are those secured at creation/modification — not outstanding balances.</CardDescription>
          </div>
          <div className="flex gap-1">
            {(["all", "open", "satisfied"] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "secondary" : "ghost"} onClick={() => setFilter(f)} className="capitalize">{f}</Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {rows.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No charges recorded in the available data.</p>
          ) : (
            <Table>
              <THead>
                <TR><TH>Charge ID</TH><TH>Charge holder</TH><TH className="text-right">Amount</TH><TH>Created</TH><TH>Modified</TH><TH>Satisfied</TH><TH>Status</TH><TH>Source</TH></TR>
              </THead>
              <TBody>
                {rows.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-mono text-xs">{c.chargeId}</TD>
                    <TD>
                      <div className="font-medium">{c.holderName}</div>
                      {c.propertyDescription && <div className="max-w-xs text-[11px] text-muted-foreground">{c.propertyDescription}</div>}
                    </TD>
                    <TD className="text-right tabular">{formatInr(c.amount)}</TD>
                    <TD className="whitespace-nowrap text-xs tabular">{formatDate(c.creationDate)}</TD>
                    <TD className="whitespace-nowrap text-xs tabular">{formatDate(c.modificationDate)}</TD>
                    <TD className="whitespace-nowrap text-xs tabular">{formatDate(c.satisfactionDate)}</TD>
                    <TD><Badge tone={c.status === "open" ? "warning" : "success"}>{c.status === "open" ? "Open" : "Satisfied"}</Badge></TD>
                    <TD><SourceBadge category={c.provenance.sourceCategory} short title={c.provenance.sourceName} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
