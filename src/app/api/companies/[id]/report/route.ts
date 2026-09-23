import { route, ok } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { generateReport } from "@/lib/services/report-service";

export const dynamic = "force-dynamic";

/** GET /api/companies/:id/report — latest report for the current data snapshot (generated if needed). */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const user = await getSessionUser(req);
  return ok(await generateReport(id, { userId: user?.id }));
});

/** POST /api/companies/:id/report — force regeneration (issues a new share link). */
export const POST = route<{ id: string }>(
  async (req, { id }) => {
    const user = await getSessionUser(req);
    return ok(await generateReport(id, { userId: user?.id, forceNew: true }));
  },
  { rateLimit: 20 },
);
