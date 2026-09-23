import { route, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { addToWatchlist, listWatchlist } from "@/lib/services/watchlist-service";
import { ValidationError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  return ok(await listWatchlist(user.id));
});

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => null)) as { identifier?: string; note?: string } | null;
  if (!body?.identifier) throw new ValidationError("identifier is required");
  return ok(await addToWatchlist(user.id, body.identifier, body.note?.slice(0, 500)), {}, { status: 201 });
});
