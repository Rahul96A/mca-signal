import { getDossier } from "./entity-service";

/** Overview payload shared by /api/companies/:cin and /api/llps/:llpin. */
export async function getOverview(id: string) {
  const d = await getDossier(id);
  const latest = d.financials?.latest ?? null;
  const open = d.charges?.filter((c) => c.status === "open") ?? null;
  return {
    sources: d.sources,
    data: {
      profile: d.profile,
      signals: d.signals,
      quality: d.quality,
      related: d.related,
      currentDirectors: (d.directors ?? []).filter((r) => r.isCurrent),
      recentFilings: (d.filings ?? []).slice(0, 6),
      keyFinancials: latest
        ? { year: latest, yoy: d.financials!.yoy[latest.financialYear] ?? {}, ratios: d.financials!.ratios[latest.financialYear] ?? null }
        : null,
      counts: {
        directors: d.directors?.length ?? null,
        currentDirectors: d.directors?.filter((r) => r.isCurrent).length ?? null,
        filings: d.filings?.length ?? null,
        delayedFilings: d.filings?.filter((f) => (f.delayDays ?? 0) > 0).length ?? null,
        charges: d.charges?.length ?? null,
        openCharges: open?.length ?? null,
        openChargeAmount: open ? open.reduce((a, c) => a + (c.amount ?? 0), 0) : null,
        financialYears: d.financials?.years.length ?? null,
      },
    },
  };
}
export type Overview = Awaited<ReturnType<typeof getOverview>>["data"];
