import { route, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { removeFromWatchlist } from "@/lib/services/watchlist-service";

export const dynamic = "force-dynamic";

export const DELETE = route<{ identifier: string }>(async (req, { identifier }) => {
  const user = await requireUser(req);
  return ok(await removeFromWatchlist(user.id, decodeURIComponent(identifier)));
});
