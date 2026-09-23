/**
 * Financial intelligence. Rules:
 *  - "reported": value exactly as provided by the source.
 *  - "calculated": arithmetic from reported values of the SAME year (formula recorded).
 *  - "derived": ratios, growth rates and CAGR computed across values.
 *  - Missing inputs → value null. Nothing is estimated or back-filled.
 */
import { METRIC_KEYS, type FinancialYearRecord, type MetricKey, type MetricValue, type Provenance } from "../domain/types";

type Row = Record<string, unknown> & { provenance: Provenance };

const COLUMN: Record<MetricKey, string> = {
  revenue: "revenue",
  otherIncome: "other_income",
  totalIncome: "total_income",
  totalExpenses: "total_expenses",
  depreciation: "depreciation",
  financeCost: "finance_cost",
  profitBeforeTax: "profit_before_tax",
  profitAfterTax: "profit_after_tax",
  ebitda: "ebitda",
  netWorth: "net_worth",
  totalAssets: "total_assets",
  totalLiabilities: "total_liabilities",
  borrowings: "borrowings",
  paidUpCapital: "paid_up_capital",
};

export const METRIC_LABELS: Record<MetricKey, string> = {
  revenue: "Revenue from operations",
  otherIncome: "Other income",
  totalIncome: "Total income",
  totalExpenses: "Total expenses",
  depreciation: "Depreciation & amortisation",
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

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const reported = (v: number | null): MetricValue => (v === null ? { value: null, basis: null } : { value: v, basis: "reported" });

export function buildFinancialRecords(rows: Row[]): FinancialYearRecord[] {
  return rows.map((r) => {
    const m = {} as Record<MetricKey, MetricValue>;
    for (const k of METRIC_KEYS) m[k] = reported(num(r[COLUMN[k]]));

    const v = (k: MetricKey) => m[k].value;
    if (v("totalIncome") === null && v("revenue") !== null && v("otherIncome") !== null) {
      m.totalIncome = { value: v("revenue")! + v("otherIncome")!, basis: "calculated", formula: "Revenue + Other income" };
    }
    if (v("ebitda") === null && v("profitBeforeTax") !== null && v("financeCost") !== null && v("depreciation") !== null) {
      m.ebitda = {
        value: v("profitBeforeTax")! + v("financeCost")! + v("depreciation")!,
        basis: "calculated",
        formula: "PBT + Finance cost + Depreciation",
      };
    }
    if (v("totalLiabilities") === null && v("totalAssets") !== null && v("netWorth") !== null) {
      m.totalLiabilities = { value: v("totalAssets")! - v("netWorth")!, basis: "calculated", formula: "Total assets − Net worth" };
    }
    if (v("totalExpenses") === null && v("totalIncome") !== null && v("profitBeforeTax") !== null) {
      m.totalExpenses = { value: v("totalIncome")! - v("profitBeforeTax")!, basis: "calculated", formula: "Total income − PBT" };
    }
    return {
      id: String(r.id),
      financialYear: String(r.financial_year),
      periodEnd: r.period_end ? String(r.period_end) : null,
      metrics: m,
      filingId: r.filing_id ? String(r.filing_id) : null,
      provenance: r.provenance,
    };
  });
}

const fyStart = (fy: string) => Number(fy.slice(0, 4));

export function growth(prev: number | null, cur: number | null): number | null {
  if (prev === null || cur === null || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

/** CAGR is only meaningful when both endpoints are positive. */
export function cagr(start: number | null, end: number | null, years: number): number | null {
  if (start === null || end === null || years <= 0 || start <= 0 || end <= 0) return null;
  return (end / start) ** (1 / years) - 1;
}

export interface Ratios {
  ebitdaMargin: number | null;
  patMargin: number | null;
  debtToEquity: number | null;
  returnOnNetWorth: number | null;
}

export interface FinancialAnalysis {
  years: FinancialYearRecord[];
  yoy: Record<string, Partial<Record<MetricKey, number | null>>>;
  ratios: Record<string, Ratios>;
  cagr: Array<{ metric: MetricKey; span: 3 | 5; from: string; to: string; value: number | null; note: string | null }>;
  latest: FinancialYearRecord | null;
  coverage: { yearsAvailable: number; firstYear: string | null; lastYear: string | null };
}

const TREND_METRICS: MetricKey[] = ["revenue", "profitAfterTax", "ebitda", "netWorth", "totalAssets", "totalLiabilities", "borrowings", "paidUpCapital"];

export function analyzeFinancials(records: FinancialYearRecord[]): FinancialAnalysis {
  const years = [...records].sort((a, b) => fyStart(a.financialYear) - fyStart(b.financialYear));
  const byStart = new Map(years.map((y) => [fyStart(y.financialYear), y]));
  const yoy: FinancialAnalysis["yoy"] = {};
  const ratios: FinancialAnalysis["ratios"] = {};

  for (const y of years) {
    const prev = byStart.get(fyStart(y.financialYear) - 1);
    yoy[y.financialYear] = {};
    for (const k of TREND_METRICS) yoy[y.financialYear][k] = prev ? growth(prev.metrics[k].value, y.metrics[k].value) : null;
    const rev = y.metrics.revenue.value;
    const nw = y.metrics.netWorth.value;
    ratios[y.financialYear] = {
      ebitdaMargin: rev && y.metrics.ebitda.value !== null ? y.metrics.ebitda.value / rev : null,
      patMargin: rev && y.metrics.profitAfterTax.value !== null ? y.metrics.profitAfterTax.value / rev : null,
      debtToEquity: nw && nw > 0 && y.metrics.borrowings.value !== null ? y.metrics.borrowings.value / nw : null,
      returnOnNetWorth: nw && nw > 0 && y.metrics.profitAfterTax.value !== null ? y.metrics.profitAfterTax.value / nw : null,
    };
  }

  const latest = years.at(-1) ?? null;
  const out: FinancialAnalysis["cagr"] = [];
  if (latest) {
    const endStart = fyStart(latest.financialYear);
    for (const span of [3, 5] as const) {
      const start = byStart.get(endStart - span);
      for (const metric of ["revenue", "profitAfterTax", "netWorth", "totalAssets"] as MetricKey[]) {
        if (!start) {
          out.push({ metric, span, from: `${endStart - span}`, to: latest.financialYear, value: null, note: `Needs ${span + 1} years of data` });
          continue;
        }
        const a = start.metrics[metric].value;
        const b = latest.metrics[metric].value;
        const value = cagr(a, b, span);
        out.push({
          metric,
          span,
          from: start.financialYear,
          to: latest.financialYear,
          value,
          note: value === null ? (a === null || b === null ? "Value not available" : "Not meaningful (non-positive endpoint)") : null,
        });
      }
    }
  }
  return {
    years,
    yoy,
    ratios,
    cagr: out,
    latest,
    coverage: { yearsAvailable: years.length, firstYear: years[0]?.financialYear ?? null, lastYear: latest?.financialYear ?? null },
  };
}
