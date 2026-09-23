import { timingSafeEqual } from "node:crypto";
import { route, ok } from "@/lib/api";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { AppError, UnauthorizedError, ValidationError } from "@/lib/services/errors";
import { refreshStaleEntities, runOgdBulkSync } from "@/lib/services/sync-service";

export const dynamic = "force-dynamic";

/** POST /api/admin/sync  (Authorization: Bearer ADMIN_TOKEN)  body: {"job":"ogd_bulk"|"refresh_stale","state"?,"maxPages"?} */
export const POST = route(
  async (req) => {
    if (!config.adminToken) throw new AppError("disabled", "ADMIN_TOKEN is not configured", 403);
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const a = Buffer.from(token);
    const b = Buffer.from(config.adminToken);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedError("Invalid admin token");
    const body = (await req.json().catch(() => ({}))) as { job?: string; state?: string; maxPages?: number };
    const db = await getDb();
    if (body.job === "ogd_bulk") return ok(await runOgdBulkSync(db, { stateCode: body.state, maxPages: Math.min(body.maxPages ?? 5, 50) }));
    if (body.job === "refresh_stale") return ok(await refreshStaleEntities(db));
    throw new ValidationError('job must be "ogd_bulk" or "refresh_stale"');
  },
  { rateLimit: 5 },
);
