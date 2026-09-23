"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { User } from "lucide-react";
import { api } from "@/lib/client/api-client";
import type { DirectorProfile } from "@/lib/domain/types";
import { formatDate, titleCase } from "@/lib/format";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from "./ui/primitives";
import { SourceBadge, StatusBadge } from "./badges";
import { ErrorState, LoadingBlock } from "./states";

type Director = DirectorProfile & { coDirectors: Array<{ din: string; name: string; shared: number }> };

export function DirectorView({ din }: { din: string }) {
  const q = useQuery({ queryKey: ["director", din], queryFn: async () => (await api<Director>(`/api/directors/${encodeURIComponent(din)}`)).data });
  if (q.isLoading) return <LoadingBlock rows={8} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const current = d.roles.filter((r) => r.isCurrent);
  const previous = d.roles.filter((r) => !r.isCurrent);

  const table = (rows: typeof d.roles, showCeased: boolean) => (
    <Table>
      <THead>
        <TR><TH>Entity</TH><TH>Status</TH><TH>Designation</TH><TH>Appointed</TH>{showCeased && <TH>Ceased</TH>}</TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={`${r.entityIdentifier}-${r.appointmentDate}`}>
            <TD>
              <Link href={`/company/${r.entityIdentifier}`} className="font-medium hover:underline">{titleCase(r.entityName)}</Link>
              <div className="font-mono text-[11px] text-muted-foreground">{r.entityIdentifier} {r.entityKind === "llp" && <Badge tone="primary" className="ml-1">LLP</Badge>}</div>
            </TD>
            <TD><StatusBadge status={r.entityStatus} /></TD>
            <TD className="text-xs">{r.designation ?? "—"}</TD>
            <TD className="whitespace-nowrap text-xs tabular">{formatDate(r.appointmentDate)}</TD>
            {showCeased && <TD className="whitespace-nowrap text-xs tabular">{formatDate(r.cessationDate)}</TD>}
          </TR>
        ))}
      </TBody>
    </Table>
  );

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <span className="grid size-12 place-items-center rounded-full bg-muted"><User className="size-6 text-muted-foreground" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{d.name}</h1>
          <p className="font-mono text-xs text-muted-foreground">DIN {d.din}{d.dinStatus ? ` · ${d.dinStatus}` : ""}{d.nationality ? ` · ${d.nationality}` : ""}</p>
        </div>
        <SourceBadge category={d.provenance.sourceCategory} title={d.provenance.sourceName} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Current companies / LLPs ({current.length})</CardTitle></CardHeader>
            <CardContent className="p-0 pb-2">{current.length ? table(current, false) : <p className="p-5 text-sm text-muted-foreground">None in available data.</p>}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Previous companies / LLPs ({previous.length})</CardTitle></CardHeader>
            <CardContent className="p-0 pb-2">{previous.length ? table(previous, true) : <p className="p-5 text-sm text-muted-foreground">None in available data.</p>}</CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Co-directors</CardTitle>
            <CardDescription>People sharing at least one entity with {d.name}.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {d.coDirectors.map((c) => (
                <li key={c.din} className="flex items-center justify-between text-sm">
                  <Link href={`/director/${c.din}`} className="hover:underline">{c.name}</Link>
                  <Badge>{c.shared} shared</Badge>
                </li>
              ))}
              {!d.coDirectors.length && <li className="text-xs text-muted-foreground">None found.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
