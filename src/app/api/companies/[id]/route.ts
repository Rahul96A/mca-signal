import { route, ok } from "@/lib/api";
import { getOverview } from "@/lib/services/overview";

export const dynamic = "force-dynamic";

/** GET /api/companies/:cin — profile, signals, data quality and summary (also accepts LLPINs). */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const o = await getOverview(id);
  return ok(o.data, { sources: o.sources });
});
