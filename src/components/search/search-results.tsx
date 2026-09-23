"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, SearchX } from "lucide-react";
import { api } from "@/lib/client/api-client";
import { useRecentSearches } from "@/lib/client/hooks";
import type { SearchResult } from "@/lib/domain/types";
import { formatDate, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Button, Card } from "../ui/primitives";
import { SourceBadge, StatusBadge } from "../badges";
import { EmptyState, ErrorState, LoadingBlock } from "../states";
import { hrefFor, TypeIcon } from "../layout/command-bar";
import { SearchBox } from "./search-box";

const TYPES = [
  { v: "all", l: "All" },
  { v: "company", l: "Companies" },
  { v: "llp", l: "LLPs" },
  { v: "director", l: "Directors" },
];

export function SearchResultsView() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const recent = useRecentSearches();
  const q = sp.get("q") ?? "";
  const type = sp.get("type") ?? "all";
  const page = Math.max(1, Number(sp.get("page") ?? 1));
  const pageSize = 20;

  const res = useQuery({
    queryKey: ["search", q, type, page],
    queryFn: () => api<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}&type=${type}&page=${page}&pageSize=${pageSize}`),
    enabled: q.trim().length >= 2,
    placeholderData: (prev) => prev,
  });

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set(k, v);
    if (k !== "page") next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  };

  const total = res.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <SearchBox key={q} initial={q} />
      <div className="flex flex-wrap items-center gap-1">
        {TYPES.map((t) => (
          <Button key={t.v} size="sm" variant={type === t.v ? "secondary" : "ghost"} onClick={() => setParam("type", t.v)}>
            {t.l}
          </Button>
        ))}
        {res.data && <span className="ml-auto text-xs text-muted-foreground">{total} result{total === 1 ? "" : "s"} for “{q}” · fuzzy matched</span>}
      </div>

      {res.data?.meta.warnings?.map((w) => (
        <div key={w} role="status" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
        </div>
      ))}
      {q.trim().length < 2 ? (
        <EmptyState title="Start typing to search" description="Search by company or LLP name (typos tolerated), 21-character CIN, LLPIN (AAB-1234), 8-digit DIN, or director name." />
      ) : res.isLoading ? (
        <LoadingBlock rows={8} />
      ) : res.error ? (
        <ErrorState error={res.error} onRetry={() => res.refetch()} />
      ) : !res.data?.data.length ? (
        <EmptyState icon={SearchX} title={`No results for “${q}”`} description="Try fewer words, check the spelling, or search by CIN/LLPIN. In live mode, entities are fetched from providers by exact identifier." />
      ) : (
        <Card className={cn("divide-y", res.isFetching && "opacity-70")}>
          {res.data.data.map((r) => (
            <Link
              key={`${r.type}-${r.identifier}`}
              href={hrefFor(r)}
              onClick={() => recent.add({ identifier: r.identifier, name: r.name, type: r.type })}
              className="flex items-center gap-3 p-4 hover:bg-muted/50"
            >
              <TypeIcon type={r.type} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.type === "director" ? r.name : titleCase(r.name)}</p>
                <p className="flex flex-wrap gap-x-3 font-mono text-[11px] text-muted-foreground">
                  <span>{r.type === "director" ? `DIN ${r.identifier}` : r.identifier}</span>
                  {r.state && <span className="font-sans">{r.state}</span>}
                  {r.incorporationDate && <span className="font-sans">Inc. {formatDate(r.incorporationDate)}</span>}
                </p>
              </div>
              <div className="hidden items-center gap-1.5 sm:flex">
                {r.type !== "director" ? <StatusBadge status={r.status} /> : <Badge>Director</Badge>}
                {r.type === "llp" && <Badge tone="primary">LLP</Badge>}
                <SourceBadge category={r.sourceCategory} short />
                <span className="w-10 text-right text-[10px] text-muted-foreground tabular" title="Match score">{Math.round(r.score * 100)}%</span>
              </div>
            </Link>
          ))}
        </Card>
      )}

      {total > pageSize && (
        <div className="flex items-center justify-end gap-1 text-xs">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))} aria-label="Previous page"><ChevronLeft /></Button>
          <span className="px-2">{page} / {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setParam("page", String(page + 1))} aria-label="Next page"><ChevronRight /></Button>
        </div>
      )}
    </div>
  );
}
