/**
 * Application-side fuzzy matching (mirrors pg_trgm semantics). Used to re-rank DB candidates and as
 * the fallback when the pg_trgm extension is unavailable.
 */
import { normalizeName } from "../identifiers";

export function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of s.toLowerCase().split(/\s+/).filter(Boolean)) {
    const padded = `  ${word} `;
    for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/**
 * Score 0..1 combining trigram similarity, prefix and whole-token containment so that
 * "brightwave" ranks "BRIGHTWAVE LOGISTICS PRIVATE LIMITED" first and typos ("brihgtwave") still match.
 */
export function matchScore(query: string, candidate: string): number {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  let score = trigramSimilarity(q, c);
  if (c.startsWith(q)) score = Math.max(score, 0.9);
  else if (c.includes(q)) score = Math.max(score, 0.75);
  const qTokens = q.split(" ");
  const cTokens = new Set(c.split(" "));
  const tokenHits = qTokens.filter((t) => cTokens.has(t) || [...cTokens].some((ct) => ct.startsWith(t) && t.length >= 3)).length;
  score = Math.max(score, (tokenHits / qTokens.length) * 0.7);
  // best per-token trigram similarity handles single-word typos
  const perToken = qTokens.map((t) => Math.max(0, ...[...cTokens].map((ct) => trigramSimilarity(t, ct))));
  const avgToken = perToken.reduce((a, b) => a + b, 0) / perToken.length;
  score = Math.max(score, avgToken * 0.65);
  return Math.round(score * 1000) / 1000;
}
