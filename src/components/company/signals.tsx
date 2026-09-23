import { AlertOctagon, AlertTriangle, Info, ShieldCheck } from "lucide-react";
import type { DataQuality, RiskSignal } from "@/lib/domain/types";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SeverityBadge, SourceBadge } from "../badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/primitives";

export function SignalList({ signals, compact }: { signals: RiskSignal[]; compact?: boolean }) {
  if (!signals.length)
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 text-success" /> No due-diligence signals generated from available data.
      </div>
    );
  return (
    <ul className="space-y-2">
      {signals.map((s) => {
        const Icon = s.severity === "attention" ? AlertOctagon : s.severity === "review" ? AlertTriangle : Info;
        return (
          <li key={s.id} className="rounded-lg border p-3">
            <div className="flex items-start gap-2.5">
              <Icon className={cn("mt-0.5 size-4 shrink-0", s.severity === "attention" ? "text-danger" : s.severity === "review" ? "text-warning" : "text-info")} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{s.title}</span>
                  <SeverityBadge severity={s.severity} />
                </div>
                {!compact && <p className="text-xs leading-relaxed text-muted-foreground">{s.detail}</p>}
                {!compact && s.evidence.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-medium">Evidence:</span> {s.evidence.slice(0, 6).map((e) => e.label).join(" · ")}
                    {s.evidence.length > 6 ? ` · +${s.evidence.length - 6} more` : ""}
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function QualityCard({ quality }: { quality: DataQuality }) {
  const tone = quality.score >= 80 ? "bg-success" : quality.score >= 50 ? "bg-warning" : "bg-danger";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Data quality &amp; coverage</CardTitle>
        <CardDescription>Describes completeness of available records — not the company.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-2">
          <span className="text-3xl font-semibold tabular">{quality.score}</span>
          <span className="pb-1 text-xs text-muted-foreground">/ 100 completeness</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={quality.score} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn("h-full rounded-full", tone)} style={{ width: `${quality.score}%` }} />
        </div>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          {Object.entries(quality.sections).map(([k, v]) => (
            <li key={k} className="flex items-center justify-between gap-2">
              <span className="capitalize text-muted-foreground">{k}</span>
              <span className={cn("tabular", !v.available && "text-muted-foreground")}>{v.available ? (k === "profile" ? v.note?.split(" ")[0] : v.count) : "n/a"}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-1">
          {quality.sourceCategories.map((c) => (
            <SourceBadge key={c} category={c} short />
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">Newest record fetched {formatDateTime(quality.freshestFetchAt)}</p>
      </CardContent>
    </Card>
  );
}
