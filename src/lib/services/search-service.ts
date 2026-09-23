/**
 * Search: exact identifier lookup (CIN / LLPIN / DIN) and fuzzy name search over the local
 * normalised database (pg_trgm when available, application-side trigram scoring otherwise).
 * In live mode, text queries are also run against provider registers (exact registered-name variants) and merged.
 */
import { getDb } from "../db/client";
import { cached } from "../cache";
import { detectIdentifier, normalizeName } from "../identifiers";
import { matchScore } from "../analysis/fuzzy";
import { liveProviders } from "../providers/registry";
import { logger, errorMessage } from "../logger";
import type { SearchResult, SourceCategory } from "../domain/types";
import { resolveEntity } from "./entity-service";
import { AppError } from "./errors";

export type SearchType = "all" | "company" | "llp" | "director";

interface CandidateRow {
  type: "company" | "llp" | "director";
  identifier: string;
  name: string;
  status: string | null;
  state: string | null;
  incorporation_date: string | null;
  source_category: SourceCategory;
}

export async function search(q: string, opts: { page?: number; pageSize?: number; type?: SearchType; remote?: boolean } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 100);
  const type = opts.type ?? "all";
  const query = q.trim();
  const warnings: string[] = [];
  if (query.length < 2) return { results: [] as SearchResult[], total: 0, page, pageSize, warnings };

  const db = await getDb();
  const id = detectIdentifier(query);

  if (id.kind === "cin" || id.kind === "llpin") {
    try {
      const { profile } = await resolveEntity(id.value);
      const r: SearchResult = {
        type: profile.kind,
        identifier: profile.identifier,
        name: profile.name,
        status: profile.status,
        state: profile.state,
        incorporationDate: profile.incorporationDate,
        score: 1,
        sourceCategory: profile.provenance.sourceCategory,
        matchedOn: "identifier",
      };
      return { results: [r], total: 1, page, pageSize, warnings };
    } catch (e) {
      if (e instanceof AppError && e.status === 404) return { results: [], total: 0, page, pageSize, warnings };
      throw e;
    }
  }

  if (id.kind === "din") {
    const rows = await db.query<CandidateRow>(
      `select 'director' as type, d.din as identifier, d.name, null as status, null as state, null as incorporation_date, ds.category as source_category
       from directors d join data_sources ds on ds.id = d.source_id where d.din = $1`,
      [id.value],
    );
    return {
      results: rows.map((r) => ({ ...toResult(r, 1), matchedOn: "identifier" as const })),
      total: rows.length,
      page,
      pageSize,
      warnings,
    };
  }

  const norm = normalizeName(query);
  if (!norm) return { results: [], total: 0, page, pageSize, warnings };
  const like = `%${norm.replace(/[%_]/g, "")}%`;
  const tokens = norm.split(" ").filter((t) => t.length >= 2);
  const candidates: CandidateRow[] = [];

  const tables: Array<{ type: CandidateRow["type"]; sql: string }> = [
    {
      type: "company",
      sql: `select 'company' as type, c.cin as identifier, c.name, c.status, c.state, c.incorporation_date, ds.category as source_category
            from companies c join data_sources ds on ds.id = c.source_id where %WHERE% limit 300`,
    },
    {
      type: "llp",
      sql: `select 'llp' as type, l.llpin as identifier, l.name, l.status, l.state, l.incorporation_date, ds.category as source_category
            from llps l join data_sources ds on ds.id = l.source_id where %WHERE% limit 300`,
    },
    {
      type: "director",
      sql: `select 'director' as type, d.din as identifier, d.name, null as status, null as state, null as incorporation_date, ds.category as source_category
            from directors d join data_sources ds on ds.id = d.source_id where %WHERE% limit 200`,
    },
  ];

  for (const t of tables) {
    if (type !== "all" && type !== t.type) continue;
    const alias = t.type === "company" ? "c" : t.type === "llp" ? "l" : "d";
    let where: string;
    let params: unknown[];
    if (db.trigramAvailable) {
      // `<%` = word_similarity operator (GIN-indexable); ILIKE catches exact substrings.
      where = `(${alias}.normalized_name ilike $1 or $2 <% ${alias}.normalized_name)`;
      params = [like, norm];
    } else {
      const ors = tokens.map((_, i) => `${alias}.normalized_name ilike $${i + 1}`);
      where = ors.length ? `(${ors.join(" or ")})` : `${alias}.normalized_name ilike $1`;
      // 3-char token prefixes keep typo'd words in the candidate set; matchScore re-ranks below.
      params = ors.length ? tokens.map((tk) => `%${tk.slice(0, 3)}%`) : [like];
    }
    try {
      candidates.push(...(await db.query<CandidateRow>(t.sql.replace("%WHERE%", where), params)));
    } catch (e) {
      logger.warn("search query failed; retrying with ILIKE", { error: errorMessage(e) });
      candidates.push(...(await db.query<CandidateRow>(t.sql.replace("%WHERE%", `${alias}.normalized_name ilike $1`), [like])));
    }
  }

  let results = candidates
    .map((r) => toResult(r, matchScore(query, r.name)))
    .filter((r) => r.score >= 0.3)
    .sort((a, b) => b.score - a.score || typeRank(a.type) - typeRank(b.type) || a.name.localeCompare(b.name));

  // Live search against provider registers (e.g. data.gov.in exact registered-name variants),
  // merged with local fuzzy matches. Cached per query so repeated searches don't hit the API.
  const wantRemote = opts.remote !== false && type !== "director" && norm.length >= 3;
  if (wantRemote) {
    const seen = new Set(results.map((r) => r.identifier));
    for (const p of liveProviders()) {
      if (!p.search || p.capabilities.nameSearch === "none") continue;
      try {
        const hits = await cached(`search:${p.source.id}:${norm}`, 3600, () => p.search!(query, 10));
        for (const h of hits) {
          if (seen.has(h.identifier) || (type !== "all" && type !== h.kind)) continue;
          seen.add(h.identifier);
          results.push({
            type: h.kind,
            identifier: h.identifier,
            name: h.name,
            status: h.status ?? null,
            state: h.state ?? null,
            incorporationDate: h.incorporationDate ?? null,
            score: Math.max(matchScore(query, h.name), 0.95), // exact registered-name match
            sourceCategory: p.source.category,
            matchedOn: "name",
          });
        }
      } catch (e) {
        logger.warn("provider search failed", { provider: p.source.id, error: errorMessage(e) });
        const limited = /429/.test(errorMessage(e));
        warnings.push(
          `${p.source.name} is ${limited ? "rate-limiting requests" : "temporarily unavailable"}, so live results from it are missing${limited ? " — try again later" : ""}.`,
        );
      }
    }
    results = results.sort((a, b) => b.score - a.score || typeRank(a.type) - typeRank(b.type));
  }

  const total = results.length;
  return { results: results.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, warnings };
}

const typeRank = (t: SearchResult["type"]) => (t === "company" ? 0 : t === "llp" ? 1 : 2);

function toResult(r: CandidateRow, score: number): SearchResult {
  return {
    type: r.type,
    identifier: r.identifier,
    name: r.name,
    status: r.status,
    state: r.state,
    incorporationDate: r.incorporation_date,
    score,
    sourceCategory: r.source_category,
    matchedOn: r.type === "director" ? "director" : "name",
  };
}
