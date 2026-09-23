"use client";
import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { api } from "@/lib/client/api-client";
import type { DataSource, SourceCategory } from "@/lib/domain/types";
import { formatDateTime } from "@/lib/format";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { SourceBadge } from "@/components/badges";
import { ErrorState, LoadingBlock } from "@/components/states";

interface Meta {
  providers: Array<{ id: string; name: string; category: SourceCategory; configured: boolean; capabilities: Record<string, boolean | string> }>;
  sources: DataSource[];
  syncLogs: Array<{ sourceId: string; jobType: string; entityIdentifier: string | null; status: string; startedAt: string; recordsFetched: number; recordsUpserted: number; error: string | null }>;
  counts: { companies: number; llps: number; directors: number; filings: number };
  database: string;
  fuzzySearch: string;
}

const CAPS = ["masterData", "nameSearch", "directors", "filings", "financials", "charges", "bulkSync"];

export default function SourcesPage() {
  const q = useQuery({ queryKey: ["meta-full"], queryFn: () => api<Meta>("/api/meta/sources") });
  if (q.isLoading) return <LoadingBlock rows={10} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const m = q.data!.data;
  const mode = q.data!.meta.dataMode;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Data sources &amp; freshness</h1>
        <p className="text-sm text-muted-foreground">
          Mode: <Badge tone={mode === "demo" ? "violet" : "success"}>{mode === "demo" ? "Demo Data" : "Live providers"}</Badge> · Database: {m.database} · Fuzzy search: {m.fuzzySearch}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Providers</CardTitle>
          <CardDescription>What each configured source can supply. Official master data (data.gov.in) does not include directors, filings, financials or charges — those require a licensed third-party provider.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          <Table>
            <THead>
              <TR><TH>Provider</TH><TH>Category</TH><TH>Configured</TH>{CAPS.map((c) => <TH key={c} className="text-center capitalize">{c.replace(/([A-Z])/g, " $1")}</TH>)}</TR>
            </THead>
            <TBody>
              {m.providers.map((p) => (
                <TR key={p.id}>
                  <TD className="font-medium">{p.name}</TD>
                  <TD><SourceBadge category={p.category} short /></TD>
                  <TD>{p.configured ? <Badge tone="success">Yes</Badge> : <Badge>No</Badge>}</TD>
                  {CAPS.map((c) => {
                    const v = p.capabilities[c];
                    return <TD key={c} className="text-center">{typeof v === "string" ? <span className="text-xs">{v}</span> : v ? <Check className="mx-auto size-4 text-success" /> : <X className="mx-auto size-4 text-muted-foreground" />}</TD>;
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {m.sources.map((s) => (
          <Card key={s.id} className="p-5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold">{s.name}</p>
              <SourceBadge category={s.category} short />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{s.description}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div><dt className="text-muted-foreground">Licence</dt><dd>{s.license ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">Last synced</dt><dd>{formatDateTime(s.lastSyncedAt)}</dd></div>
              <div><dt className="text-muted-foreground">Dataset published/updated</dt><dd>{formatDateTime(s.publishedAt)}</dd></div>
              {s.url && <div><dt className="text-muted-foreground">URL</dt><dd className="truncate"><a className="text-primary hover:underline" href={s.url} target="_blank" rel="noopener noreferrer">{s.url.replace(/^https?:\/\//, "")}</a></dd></div>}
            </dl>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>Recent sync jobs</CardTitle></CardHeader>
        <CardContent className="p-0 pb-2">
          <Table>
            <THead><TR><TH>Started</TH><TH>Source</TH><TH>Job</TH><TH>Entity</TH><TH>Status</TH><TH className="text-right">Fetched</TH><TH className="text-right">Upserted</TH></TR></THead>
            <TBody>
              {m.syncLogs.map((l, i) => (
                <TR key={i}>
                  <TD className="whitespace-nowrap text-xs">{formatDateTime(l.startedAt)}</TD>
                  <TD className="text-xs">{l.sourceId}</TD>
                  <TD className="text-xs">{l.jobType}</TD>
                  <TD className="font-mono text-xs">{l.entityIdentifier ?? "—"}</TD>
                  <TD><Badge tone={l.status === "success" ? "success" : l.status === "error" ? "danger" : "warning"} title={l.error ?? ""}>{l.status}</Badge></TD>
                  <TD className="text-right tabular text-xs">{l.recordsFetched}</TD>
                  <TD className="text-right tabular text-xs">{l.recordsUpserted}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
