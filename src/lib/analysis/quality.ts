import type { Charge, DataQuality, DirectorRole, EntityProfile, Filing, FinancialYearRecord, Provenance, SourceCategory } from "../domain/types";

const PROFILE_FIELDS: Array<keyof EntityProfile> = ["status", "incorporationDate", "roc", "state", "industry", "registeredOffice"];

/** Completeness & freshness indicator. Describes the DATA, not the company. */
export function computeDataQuality(args: {
  profile: EntityProfile;
  directors: DirectorRole[] | null;
  filings: Filing[] | null;
  financials: FinancialYearRecord[] | null;
  charges: Charge[] | null;
}): DataQuality {
  const { profile } = args;
  const profileFields = profile.kind === "company" ? [...PROFILE_FIELDS, "paidUpCapital" as const, "authorizedCapital" as const] : [...PROFILE_FIELDS, "totalContribution" as const];
  const filled = profileFields.filter((f) => profile[f] !== null && profile[f] !== undefined).length;

  const sections: DataQuality["sections"] = {
    profile: { available: true, count: filled, note: `${filled}/${profileFields.length} key fields present` },
    directors: { available: args.directors !== null, count: args.directors?.length ?? 0 },
    filings: { available: args.filings !== null, count: args.filings?.length ?? 0 },
    financials: { available: args.financials !== null && args.financials.length > 0, count: args.financials?.length ?? 0 },
    charges: { available: args.charges !== null, count: args.charges?.length ?? 0 },
  };
  const weights = { profile: 30, directors: 20, filings: 20, financials: 20, charges: 10 };
  let score = (filled / profileFields.length) * weights.profile;
  if (sections.directors.available && sections.directors.count > 0) score += weights.directors;
  if (sections.filings.available && sections.filings.count > 0) score += weights.filings;
  if (sections.financials.available) score += Math.min(1, sections.financials.count / 3) * weights.financials;
  if (sections.charges.available) score += weights.charges;

  const provs: Provenance[] = [
    profile.provenance,
    ...(args.directors ?? []).map((d) => d.provenance),
    ...(args.filings ?? []).map((f) => f.provenance),
    ...(args.financials ?? []).map((f) => f.provenance),
    ...(args.charges ?? []).map((c) => c.provenance),
  ];
  const fetches = provs.map((p) => p.fetchedAt).filter((x): x is string => Boolean(x)).sort();
  const cats = [...new Set(provs.map((p) => p.sourceCategory))] as SourceCategory[];
  return {
    score: Math.round(score),
    sections,
    freshestFetchAt: fetches.at(-1) ?? null,
    oldestFetchAt: fetches[0] ?? null,
    sourceCategories: cats,
  };
}
