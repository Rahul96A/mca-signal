import { route, ok } from "@/lib/api";
import { getDirector } from "@/lib/services/network-service";

export const dynamic = "force-dynamic";

/** GET /api/directors/:din — director with current/previous companies and co-directors. */
export const GET = route<{ din: string }>(async (_req, { din }) => ok(await getDirector(din)));
