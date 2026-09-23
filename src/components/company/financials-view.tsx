"use client";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useCompanyQuery } from "./use-company";
import type { FinancialAnalysis } from "@/lib/analysis/financials";
import { METRIC_KEYS, type MetricKey } from "@/lib/domain/types";
import { formatCr, formatInr, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BasisBadge, SourceBadge } from "../badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from "../ui/primitives";
import { EmptyState, ErrorState, LoadingBlock } from "../states";
import { LineChart as LineIcon } from "lucide-react";

const LABELS: Record<MetricKey, string> = {
  revenue: "Revenue from operations",
  otherIncome: "Other income",
  totalIncome: "Total income",
  totalExpenses: "Total expenses",
  depreciation: "Depreciation",
  financeCost: "Finance cost",
  profitBeforeTax: "Profit before tax",
  profitAfterTax: "Profit / (loss) after tax",
  ebitda: "EBITDA",
  netWorth: "Net worth",
  totalAssets: "Total assets",
  totalLiabilities: "Total liabilities",
  borrowings: "Borrowings",
  paidUpCapital: "Paid-up capital",
};

const C = { s1: "var(--chart-1)", s2: "var(--chart-2)", s3: "var(--chart-3)", grid: "var(--chart-grid)" };
const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" };
const tooltipStyle = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" };
const crTick = (v: number) => `${(v / 1e7).toFixed(v !== 0 && Math.abs(v) < 1e7 ? 1 : 0)}`;

function ChartCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="h-64">{children}</CardContent>
    </Card>
  );
}

function Legendary() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1"><BasisBadge basis="reported" /> Reported</span>
      <span className="inline-flex items-center gap-1"><BasisBadge basis="calculated" /> Calculated from reported values</span>
      <span className="inline-flex items-center gap-1"><BasisBadge basis="derived" /> Estimated / Derived (ratios, growth, CAGR)</span>
      <span>— = not available (never estimated)</span>
    </div>
  );
}

export function FinancialsView({ identifier }: { identifier: string }) {
  const q = useCompanyQuery<{ available: boolean; analysis: FinancialAnalysis | null }>(identifier, "/financials");
  if (q.isLoading) return <LoadingBlock rows={8} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data!.data.analysis;
  if (!q.data!.data.available || !a) {
    return <EmptyState icon={LineIcon} title="No structured financial data available" description="The configured data sources do not provide structured financial statements for this entity. Official data.gov.in master data does not include financials; configure a licensed third-party provider. No values are estimated." />;
  }

  const chartData = a.years.map((y) => ({
    fy: `FY${y.financialYear.slice(2)}`,
    revenue: y.metrics.revenue.value,
    ebitda: y.metrics.ebitda.value,
    pat: y.metrics.profitAfterTax.value,
    assets: y.metrics.totalAssets.value,
    liabilities: y.metrics.totalLiabilities.value,
    netWorth: y.metrics.netWorth.value,
    borrowings: y.metrics.borrowings.value,
  }));
  const tip = (v: unknown) => formatInr(typeof v === "number" ? v : null);
  const sources = [...new Map(a.years.map((y) => [y.provenance.sourceId, y.provenance])).values()];

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <Legendary />
        <div className="flex flex-wrap gap-1">
          {sources.map((s) => (
            <SourceBadge key={s.sourceId} category={s.sourceCategory} title={s.sourceName} />
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Revenue, EBITDA and profit after tax" description="₹ crore, by financial year. EBITDA is calculated (PBT + finance cost + depreciation) where components are reported.">
          <ResponsiveContainer>
            <BarChart data={chartData} barGap={2} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke={C.grid} />
              <XAxis dataKey="fy" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={crTick} width={44} />
              <Tooltip formatter={tip} contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} itemSorter={null} />
              <Bar dataKey="revenue" name="Revenue" fill={C.s1} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="ebitda" name="EBITDA" fill={C.s2} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="pat" name="PAT" fill={C.s3} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Balance sheet" description="₹ crore. Total liabilities are calculated as total assets − net worth when not reported.">
          <ResponsiveContainer>
            <BarChart data={chartData} barGap={2} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke={C.grid} />
              <XAxis dataKey="fy" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={crTick} width={44} />
              <Tooltip formatter={tip} contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} itemSorter={null} />
              <Bar dataKey="assets" name="Total assets" fill={C.s1} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="liabilities" name="Total liabilities" fill={C.s2} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="netWorth" name="Net worth" fill={C.s3} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Borrowings" description="₹ crore, as reported. Compare with registered charges on the Charges tab.">
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid vertical={false} stroke={C.grid} />
              <XAxis dataKey="fy" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={crTick} width={44} />
              <Tooltip formatter={tip} contentStyle={tooltipStyle} />
              <Line dataKey="borrowings" name="Borrowings" stroke={C.s1} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: "var(--card)" }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <Card>
          <CardHeader>
            <CardTitle>Growth (CAGR)</CardTitle>
            <CardDescription>Derived. Shown only when both endpoint values are positive and available.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR>
                  <TH>Metric</TH>
                  <TH className="text-right">3-year</TH>
                  <TH className="text-right">5-year</TH>
                </TR>
              </THead>
              <TBody>
                {(["revenue", "profitAfterTax", "netWorth", "totalAssets"] as MetricKey[]).map((m) => {
                  const c3 = a.cagr.find((c) => c.metric === m && c.span === 3);
                  const c5 = a.cagr.find((c) => c.metric === m && c.span === 5);
                  const cell = (c?: (typeof a.cagr)[number]) => (
                    <TD className="text-right tabular" title={c?.note ?? `FY ${c?.from} → FY ${c?.to}`}>
                      {c?.value !== null && c?.value !== undefined ? formatPct(c.value) : <span className="text-xs text-muted-foreground">{c?.note ?? "—"}</span>}
                    </TD>
                  );
                  return (
                    <TR key={m}>
                      <TD>{LABELS[m]}</TD>
                      {cell(c3)}
                      {cell(c5)}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Financial statements summary (₹ crore)</CardTitle>
          <CardDescription>Year-over-year change shown beneath each value (derived). Hover a badge for its basis or formula.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH className="sticky left-0 bg-card">Metric</TH>
                {a.years.map((y) => (
                  <TH key={y.financialYear} className="text-right">FY {y.financialYear}</TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {METRIC_KEYS.map((k) => (
                <TR key={k}>
                  <TD className="sticky left-0 bg-card text-xs font-medium">{LABELS[k]}</TD>
                  {a.years.map((y) => {
                    const m = y.metrics[k];
                    const yoy = a.yoy[y.financialYear]?.[k];
                    return (
                      <TD key={y.financialYear} className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className={cn("tabular", (m.value ?? 0) < 0 && "text-danger", m.value === null && "text-muted-foreground")}>{formatCr(m.value)}</span>
                          <BasisBadge basis={m.basis} formula={m.formula} />
                        </div>
                        {yoy !== undefined && yoy !== null && <div className={cn("text-[10px] tabular", yoy >= 0 ? "text-success" : "text-danger")}>{formatPct(yoy)}</div>}
                      </TD>
                    );
                  })}
                </TR>
              ))}
              <TR>
                <TD className="sticky left-0 bg-card text-xs font-medium">PAT margin <BasisBadge basis="derived" /></TD>
                {a.years.map((y) => <TD key={y.financialYear} className="text-right tabular">{formatPct(a.ratios[y.financialYear]?.patMargin)}</TD>)}
              </TR>
              <TR>
                <TD className="sticky left-0 bg-card text-xs font-medium">EBITDA margin <BasisBadge basis="derived" /></TD>
                {a.years.map((y) => <TD key={y.financialYear} className="text-right tabular">{formatPct(a.ratios[y.financialYear]?.ebitdaMargin)}</TD>)}
              </TR>
              <TR>
                <TD className="sticky left-0 bg-card text-xs font-medium">Debt / equity <BasisBadge basis="derived" /></TD>
                {a.years.map((y) => {
                  const v = a.ratios[y.financialYear]?.debtToEquity;
                  return <TD key={y.financialYear} className="text-right tabular">{v === null || v === undefined ? "—" : `${v.toFixed(2)}×`}</TD>;
                })}
              </TR>
              <TR>
                <TD className="sticky left-0 bg-card text-xs font-medium">Return on net worth <BasisBadge basis="derived" /></TD>
                {a.years.map((y) => <TD key={y.financialYear} className="text-right tabular">{formatPct(a.ratios[y.financialYear]?.returnOnNetWorth)}</TD>)}
              </TR>
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
