import { route, ok } from "@/lib/api";
import { getDossier } from "@/lib/services/entity-service";

export const dynamic = "force-dynamic";

/** GET /api/companies/:id/directors — current and former directors / designated partners. */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const d = await getDossier(id);
  return ok({ available: d.directors !== null, directors: d.directors ?? [], related: d.related }, { sources: d.sources });
});
