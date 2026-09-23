import { route, ok, intParam } from "@/lib/api";
import { search, type SearchType } from "@/lib/services/search-service";

export const dynamic = "force-dynamic";

/** GET /api/search?q=&page=&pageSize=&type=all|company|llp|director&remote=0 (remote=0 → local index only, used for type-ahead) */
export const GET = route(async (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 200);
  const type = (url.searchParams.get("type") ?? "all") as SearchType;
  const res = await search(q, { page: intParam(url, "page", 1), pageSize: intParam(url, "pageSize", 20), type, remote: url.searchParams.get("remote") !== "0" });
  return ok(res.results, { page: res.page, pageSize: res.pageSize, total: res.total, ...(res.warnings.length ? { warnings: res.warnings } : {}) });
});
