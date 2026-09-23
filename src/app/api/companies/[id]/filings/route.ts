import { route, ok, intParam } from "@/lib/api";
import { getDossier } from "@/lib/services/entity-service";
import { KEY_FORMS } from "@/lib/domain/forms";

export const dynamic = "force-dynamic";

/** GET /api/companies/:id/filings?page=&pageSize=&formType=&year=&delayedOnly=1 */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const url = new URL(req.url);
  const d = await getDossier(id);
  const page = intParam(url, "page", 1);
  const pageSize = Math.min(intParam(url, "pageSize", 25), 200);
  const formType = url.searchParams.get("formType");
  const year = url.searchParams.get("year");
  const delayedOnly = url.searchParams.get("delayedOnly") === "1";
  const all = d.filings ?? [];
  let items = all;
  if (formType) items = items.filter((f) => f.formType === formType);
  if (year) items = items.filter((f) => f.financialYear === year || f.filingDate?.startsWith(year));
  if (delayedOnly) items = items.filter((f) => (f.delayDays ?? 0) > 0);
  const types = [...new Set(all.map((f) => f.formType))].sort();
  return ok(
    {
      available: d.filings !== null,
      items: items.slice((page - 1) * pageSize, page * pageSize),
      formTypes: types,
      financialYears: [...new Set(all.map((f) => f.financialYear).filter((x): x is string => Boolean(x)))].sort().reverse(),
      keyForms: KEY_FORMS,
      stats: {
        total: all.length,
        delayed: all.filter((f) => (f.delayDays ?? 0) > 0).length,
        byForm: Object.fromEntries(types.map((t) => [t, all.filter((f) => f.formType === t).length])),
      },
    },
    { page, pageSize, total: items.length, sources: d.sources },
  );
});
