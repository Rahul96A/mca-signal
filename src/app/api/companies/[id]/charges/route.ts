import { route, ok } from "@/lib/api";
import { getDossier } from "@/lib/services/entity-service";

export const dynamic = "force-dynamic";

/** GET /api/companies/:id/charges — registered charges with open vs satisfied summary. */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const d = await getDossier(id);
  const charges = d.charges ?? [];
  const open = charges.filter((c) => c.status === "open");
  const satisfied = charges.filter((c) => c.status === "satisfied");
  const sum = (xs: typeof charges) => xs.reduce((a, c) => a + (c.amount ?? 0), 0);
  const latest = d.financials?.latest ?? null;
  return ok(
    {
      available: d.charges !== null,
      charges,
      summary: { open: open.length, satisfied: satisfied.length, openAmount: sum(open), satisfiedAmount: sum(satisfied), lenders: [...new Set(open.map((c) => c.holderName))] },
      latestBorrowings: latest ? { financialYear: latest.financialYear, value: latest.metrics.borrowings, netWorth: latest.metrics.netWorth } : null,
      signals: d.signals.filter((s) => s.category === "charges"),
    },
    { sources: d.sources },
  );
});
