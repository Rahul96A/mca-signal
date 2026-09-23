import { route, ok } from "@/lib/api";
import { getDossier } from "@/lib/services/entity-service";

export const dynamic = "force-dynamic";

/** GET /api/companies/:id/financials — per-year metrics (reported/calculated), YoY, ratios, CAGR. */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const d = await getDossier(id);
  return ok({ available: d.financials !== null && d.financials.years.length > 0, analysis: d.financials }, { sources: d.sources });
});
