import { route, ok } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => ok(await getSessionUser(req)));
