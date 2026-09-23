"use client";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useOverview } from "./use-company";
import { formatDate, formatInr, formatPct, titleCase } from "@/lib/format";
import type { MetricKey } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/primitives";
import { BasisBadge, SourceBadge, StatusBadge } from "../badges";
import { LoadingBlock } from "../states";
import { QualityCard, SignalList } from "./signals";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children ?? "—"}</dd>
    </div>
  );
}

export function Delta({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return null;
  const up = v >= 0;
  return (
    <span className={cn("inline-flex items-center text-xs tabular", up ? "text-success" : "text-danger")} title="Year-over-year change (derived)">
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {formatPct(v)}
    </span>
  );
}

export function OverviewView({ identifier }: { identifier: string }) {
  const { data, isLoading } = useOverview(identifier);
  if (isLoading || !data) return <div className="grid gap-4 lg:grid-cols-3"><LoadingBlock /><LoadingBlock /><LoadingBlock /></div>;
  const o = data.data;
  const p = o.profile;
  const kf = o.keyFinancials;
  const base = `/company/${encodeURIComponent(identifier)}`;
  const kpis: Array<{ key: MetricKey; label: string }> = [
    { key: "revenue", label: "Revenue" },
    { key: "profitAfterTax", label: "Profit after tax" },
    { key: "netWorth", label: "Net worth" },
    { key: "totalAssets", label: "Total assets" },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {kpis.map((k) => {
            const m = kf?.year.metrics[k.key];
            return (
              <Card key={k.key} className="p-4">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                  {k.label} <BasisBadge basis={m?.basis ?? null} formula={m?.formula} />
                </div>
                <div className={cn("mt-1 text-lg font-semibold tabular", (m?.value ?? 0) < 0 && "text-danger")}>{formatInr(m?.value ?? null)}</div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{kf ? `FY ${kf.year.financialYear}` : "Not available"}</span>
                  <Delta v={kf?.yoy[k.key]} />
                </div>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Due-diligence signals</CardTitle>
              <CardDescription>Factual observations from available records. Neutral wording; verify before relying on them.</CardDescription>
            </div>
            <Badge tone="info">AI-Derived Analysis (rule-based)</Badge>
          </CardHeader>
          <CardContent>
            <SignalList signals={o.signals} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Company profile</CardTitle>
            <SourceBadge category={p.provenance.sourceCategory} title={p.provenance.sourceName} />
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={p.kind === "llp" ? "LLPIN" : "CIN"}><span className="font-mono">{p.identifier}</span></Field>
              <Field label="Status"><StatusBadge status={p.status} /></Field>
              <Field label="Type / class">{p.companyClass}</Field>
              <Field label="Category">{p.category}</Field>
              <Field label="Sub-category">{p.subCategory}</Field>
              <Field label="Listing">{p.listingStatus}</Field>
              <Field label="Incorporation date">{formatDate(p.incorporationDate)}</Field>
              <Field label="Company age">{p.ageYears !== null ? `${p.ageYears} years` : "—"}</Field>
              <Field label="ROC">{p.roc}</Field>
              <Field label="State">{p.state}</Field>
              <Field label="Industry">{p.industry}</Field>
              <Field label="NIC code">{p.nicCode}</Field>
              {p.kind === "company" ? (
                <>
                  <Field label="Authorised capital">{formatInr(p.authorizedCapital)}</Field>
                  <Field label="Paid-up capital">{formatInr(p.paidUpCapital)}</Field>
                </>
              ) : (
                <Field label="Total contribution">{formatInr(p.totalContribution)}</Field>
              )}
              <Field label="Last AGM">{formatDate(p.lastAgmDate)}</Field>
              <Field label="Last balance sheet">{formatDate(p.lastBalanceSheetDate)}</Field>
              <div className="sm:col-span-2 lg:col-span-3">
                <Field label="Principal business activity">{p.principalActivity}</Field>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <Field label="Registered office">
                  {p.registeredOffice ? `${p.registeredOffice.line}${p.registeredOffice.city ? `, ${p.registeredOffice.city}` : ""}${p.registeredOffice.state ? `, ${p.registeredOffice.state}` : ""}${p.registeredOffice.pincode ? ` ${p.registeredOffice.pincode}` : ""}` : "—"}
                </Field>
              </div>
            </dl>
            {(p.nameHistory.length > 0 || p.addressHistory.length > 1) && (
              <div className="mt-5 grid gap-4 border-t pt-4 sm:grid-cols-2">
                {p.nameHistory.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium">Name history</p>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {p.nameHistory.map((n) => (
                        <li key={n.id}>
                          <span className="text-foreground">{titleCase(n.previousName)}</span> — changed {formatDate(n.changedOn)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {p.addressHistory.length > 1 && (
                  <div>
                    <p className="mb-2 text-xs font-medium">Registered office history</p>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {p.addressHistory.map((a) => (
                        <li key={a.id}>
                          <span className="text-foreground">{a.line}{a.city ? `, ${a.city}` : ""}</span> — {formatDate(a.effectiveFrom)} to {a.effectiveTo ? formatDate(a.effectiveTo) : "present"}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <QualityCard quality={o.quality} />
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{p.kind === "llp" ? "Designated partners" : "Current directors"}</CardTitle>
            <Link href={`${base}/directors`} className="text-xs text-primary hover:underline">All</Link>
          </CardHeader>
          <CardContent>
            {o.counts.directors === null ? (
              <p className="text-xs text-muted-foreground">Director data not available from configured sources.</p>
            ) : o.currentDirectors.length === 0 ? (
              <p className="text-xs text-muted-foreground">No current directors in available data.</p>
            ) : (
              <ul className="space-y-2.5">
                {o.currentDirectors.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/director/${d.din}`} className="min-w-0 truncate hover:underline">{d.name}</Link>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{d.designation} · {formatDate(d.appointmentDate)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent filings</CardTitle>
            <Link href={`${base}/filings`} className="text-xs text-primary hover:underline">Timeline</Link>
          </CardHeader>
          <CardContent>
            {o.counts.filings === null ? (
              <p className="text-xs text-muted-foreground">Filing data not available from configured sources.</p>
            ) : (
              <ul className="space-y-2">
                {o.recentFilings.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{f.formType}</span> <span className="text-xs text-muted-foreground">{f.financialYear ? `FY ${f.financialYear}` : ""}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                      {(f.delayDays ?? 0) > 0 && <Badge tone="warning">+{f.delayDays}d</Badge>}
                      {formatDate(f.filingDate)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Charges</CardTitle>
            <Link href={`${base}/charges`} className="text-xs text-primary hover:underline">Details</Link>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            {o.counts.charges === null ? (
              <p className="col-span-2 text-xs text-muted-foreground">Charge data not available from configured sources.</p>
            ) : (
              <>
                <div>
                  <p className="text-[11px] uppercase text-muted-foreground">Open</p>
                  <p className="text-lg font-semibold tabular">{o.counts.openCharges}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase text-muted-foreground">Open amount</p>
                  <p className="text-lg font-semibold tabular">{formatInr(o.counts.openChargeAmount)}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
        {o.related.length > 0 && (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Connected entities</CardTitle>
              <Link href={`${base}/network`} className="text-xs text-primary hover:underline">Graph</Link>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {o.related.slice(0, 6).map((r) => (
                  <li key={r.identifier} className="text-sm">
                    <Link href={`/company/${r.identifier}`} className="hover:underline">{titleCase(r.name)}</Link>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      via {r.viaName} <StatusBadge status={r.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
