import { route, ok } from "@/lib/api";
import { getReportByShareToken } from "@/lib/services/report-service";

export const dynamic = "force-dynamic";

/** GET /api/reports/:shareToken — immutable shared report snapshot. */
export const GET = route<{ token: string }>(async (_req, { token }) => ok(await getReportByShareToken(token)));
