"use client";
import Link from "next/link";
import { Users } from "lucide-react";
import { useCompanyQuery } from "./use-company";
import type { DirectorRole, NetworkGraph } from "@/lib/domain/types";
import type { RelatedEntity } from "@/lib/analysis/risk";
import { formatDate, titleCase } from "@/lib/format";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from "../ui/primitives";
import { SourceBadge, StatusBadge } from "../badges";
import { EmptyState, ErrorState, LoadingBlock } from "../states";

function tenure(from: string | null, to: string | null) {
  if (!from) return "—";
  const end = to ? Date.parse(to) : Date.now();
  const yrs = (end - Date.parse(from)) / (365.25 * 86400000);
  return yrs < 1 ? `${Math.round(yrs * 12)} mo` : `${yrs.toFixed(1)} yrs`;
}

function RolesTable({ roles, current }: { roles: DirectorRole[]; current: boolean }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Name</TH><TH>DIN</TH><TH>Designation</TH><TH>Appointed</TH>{!current && <TH>Ceased</TH>}<TH>Tenure</TH><TH>Source</TH>
        </TR>
      </THead>
      <TBody>
        {roles.map((r) => (
          <TR key={r.id}>
            <TD><Link href={`/director/${r.din}`} className="font-medium hover:underline">{r.name}</Link></TD>
            <TD className="font-mono text-xs">{r.din}</TD>
            <TD className="text-xs">{r.designation ?? "—"}</TD>
            <TD className="whitespace-nowrap tabular text-xs">{formatDate(r.appointmentDate)}</TD>
            {!current && <TD className="whitespace-nowrap tabular text-xs">{formatDate(r.cessationDate)}</TD>}
            <TD className="text-xs text-muted-foreground">{tenure(r.appointmentDate, r.cessationDate)}</TD>
            <TD><SourceBadge category={r.provenance.sourceCategory} short title={r.provenance.sourceName} /></TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function DirectorsView({ identifier }: { identifier: string }) {
  const q = useCompanyQuery<{ available: boolean; directors: DirectorRole[]; related: RelatedEntity[] }>(identifier, "/directors");
  const net = useCompanyQuery<NetworkGraph>(identifier, "/network?depth=1");
  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!.data;
  if (!d.available) return <EmptyState icon={Users} title="Director data not available" description="The configured data sources do not provide director / designated partner records for this entity." />;
  const current = d.directors.filter((r) => r.isCurrent);
  const former = d.directors.filter((r) => !r.isCurrent);
  const common = net.data?.data.commonDirectors ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Current directors / partners ({current.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-2">{current.length ? <RolesTable roles={current} current /> : <p className="p-5 text-sm text-muted-foreground">None in available data.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Former directors / partners ({former.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-2">{former.length ? <RolesTable roles={former} current={false} /> : <p className="p-5 text-sm text-muted-foreground">None in available data.</p>}</CardContent>
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Common directors</CardTitle>
            <CardDescription>Other entities sharing at least one director/partner with this entity.</CardDescription>
          </CardHeader>
          <CardContent>
            {common.length === 0 ? (
              <p className="text-xs text-muted-foreground">No shared directors found.</p>
            ) : (
              <ul className="space-y-3">
                {common.map((c) => (
                  <li key={c.entityIdentifier} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/company/${c.entityIdentifier}`} className="font-medium hover:underline">{titleCase(c.entityName)}</Link>
                      <Badge tone={c.sharedDirectors.length > 1 ? "primary" : "neutral"}>{c.sharedDirectors.length} shared</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{c.sharedDirectors.map((s) => s.name).join(", ")}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Connected entities</CardTitle>
            <CardDescription>Shared appointments only; implies no relationship beyond that.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {d.related.map((r) => (
                <li key={r.identifier} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/company/${r.identifier}`} className="min-w-0 truncate hover:underline">{titleCase(r.name)}</Link>
                  <StatusBadge status={r.status} />
                </li>
              ))}
              {!d.related.length && <li className="text-xs text-muted-foreground">None found.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
