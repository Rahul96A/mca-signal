import { route, ok, intParam } from "@/lib/api";
import { getNetwork } from "@/lib/services/network-service";

export const dynamic = "force-dynamic";

/** GET /api/companies/:id/network?depth=1..3 — Company → Director → Companies/LLPs graph. */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const depth = intParam(new URL(req.url), "depth", 2);
  return ok(await getNetwork(id, depth));
});
