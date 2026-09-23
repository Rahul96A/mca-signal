import { route, ok } from "@/lib/api";
import { getOverview } from "@/lib/services/overview";
import { LLPIN_RE, normalizeIdentifier } from "@/lib/identifiers";
import { ValidationError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

/** GET /api/llps/:llpin */
export const GET = route<{ llpin: string }>(async (_req, { llpin }) => {
  if (!LLPIN_RE.test(normalizeIdentifier(llpin))) throw new ValidationError("LLPIN must look like AAB-1234");
  const o = await getOverview(llpin);
  return ok(o.data, { sources: o.sources });
});
