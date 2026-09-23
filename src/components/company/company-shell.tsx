"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bookmark, BookmarkCheck, Check, Copy, Download, FileSpreadsheet, FileText, FlaskConical, Share2 } from "lucide-react";
import { useOverview } from "./use-company";
import { useRecentSearches, useSession, useWatchlist, useWatchlistMutations } from "@/lib/client/hooks";
import { api } from "@/lib/client/api-client";
import { formatDate, timeAgo, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CompanyReport } from "@/lib/domain/types";
import { Badge, Button, Card, Skeleton } from "../ui/primitives";
import { SourceBadge, StatusBadge } from "../badges";
import { ErrorState } from "../states";

const TABS = [
  { slug: "", label: "Overview" },
  { slug: "/financials", label: "Financials" },
  { slug: "/filings", label: "Filings" },
  { slug: "/directors", label: "Directors" },
  { slug: "/charges", label: "Charges" },
  { slug: "/network", label: "Network" },
  { slug: "/report", label: "AI Report" },
];

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      aria-label={label ?? "Copy"}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function ExportMenu({ identifier }: { identifier: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const base = `/api/companies/${encodeURIComponent(identifier)}/export`;
  const items = [
    { href: `${base}?format=pdf`, label: "Full report (PDF)", icon: FileText },
    ...["financials", "filings", "directors", "charges", "signals", "network"].map((s) => ({ href: `${base}?format=csv&section=${s}`, label: `${s[0].toUpperCase()}${s.slice(1)} (CSV)`, icon: FileSpreadsheet })),
  ];
  return (
    <div className="relative" ref={ref}>
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Download /> Export
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-52 rounded-lg border bg-card p-1 shadow-lg">
          {items.map((i) => (
            <a key={i.href} href={i.href} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted" onClick={() => setOpen(false)}>
              <i.icon className="size-4 text-muted-foreground" /> {i.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function WatchButton({ identifier }: { identifier: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: user } = useSession();
  const { data: list } = useWatchlist(Boolean(user));
  const { add, remove } = useWatchlistMutations();
  const watched = list?.some((w) => w.entityIdentifier === identifier);
  const busy = add.isPending || remove.isPending;
  return (
    <Button
      variant={watched ? "secondary" : "outline"}
      size="sm"
      disabled={busy}
      onClick={() => {
        if (!user) return router.push(`/login?next=${encodeURIComponent(pathname)}`);
        (watched ? remove : add).mutate(identifier);
      }}
    >
      {watched ? <BookmarkCheck /> : <Bookmark />} {watched ? "Watching" : "Watch"}
    </Button>
  );
}

function ShareButton({ identifier }: { identifier: string }) {
  const [state, setState] = useState<"idle" | "busy" | "copied">("idle");
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={state === "busy"}
      onClick={async () => {
        setState("busy");
        try {
          const r = (await api<CompanyReport>(`/api/companies/${encodeURIComponent(identifier)}/report`)).data;
          const url = `${window.location.origin}/company/${encodeURIComponent(identifier)}/report?share=${r.shareToken}`;
          await navigator.clipboard?.writeText(url);
          setState("copied");
          setTimeout(() => setState("idle"), 2000);
        } catch {
          setState("idle");
        }
      }}
      title="Copy a shareable link to an immutable report snapshot"
    >
      {state === "copied" ? <Check /> : <Share2 />} {state === "copied" ? "Link copied" : "Share"}
    </Button>
  );
}

export function CompanyShell({ identifier, children }: { identifier: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const { data, isLoading, error, refetch } = useOverview(identifier);
  const recent = useRecentSearches();
  const p = data?.data.profile;

  useEffect(() => {
    if (p) {
      recent.add({ identifier: p.identifier, name: p.name, type: p.kind });
      document.title = `${titleCase(p.name)} · MCA Signal`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.identifier]);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const base = `/company/${encodeURIComponent(identifier)}`;
  const isDemo = data?.meta.dataMode === "demo" || p?.provenance.sourceCategory === "demo";

  return (
    <div className="space-y-5">
      {isDemo && (
        <div className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-800 dark:text-violet-200 no-print">
          <FlaskConical className="size-4 shrink-0" />
          <span>
            <strong>Demo Data</strong> — this is a fictional entity from the bundled demo dataset. Configure <code>DATA_GOV_API_KEY</code> / <code>MCA_PROVIDER_API_KEY</code> to use real data.
          </span>
        </div>
      )}
      <Card className="p-5">
        {isLoading || !p ? (
          <div className="space-y-3">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ) : (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={p.status} />
                <Badge tone="primary">{p.kind === "llp" ? "LLP" : p.companyClass ?? "Company"}</Badge>
                <SourceBadge category={p.provenance.sourceCategory} title={p.provenance.sourceName} />
              </div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{titleCase(p.name)}</h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 font-mono text-foreground">
                  {p.kind === "llp" ? "LLPIN" : "CIN"} {p.identifier} <CopyButton text={p.identifier} label="Copy identifier" />
                </span>
                <span>Incorporated {formatDate(p.incorporationDate)}{p.ageYears !== null ? ` · ${p.ageYears} yrs` : ""}</span>
                <span>{p.roc ?? "ROC n/a"}</span>
                <span title={p.provenance.fetchedAt ?? ""}>Fetched {timeAgo(p.provenance.fetchedAt)}{p.provenance.lastUpdatedAt ? ` · source updated ${formatDate(p.provenance.lastUpdatedAt)}` : ""}</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 no-print">
              <WatchButton identifier={p.identifier} />
              <ShareButton identifier={p.identifier} />
              <ExportMenu identifier={p.identifier} />
            </div>
          </div>
        )}
      </Card>
      <nav className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 no-print" aria-label="Company sections">
        {TABS.map((t) => {
          const href = `${base}${t.slug}`;
          const active = t.slug === "" ? pathname === base : pathname.startsWith(href);
          return (
            <Link
              key={t.slug}
              href={href}
              className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground", active ? "border-primary font-medium text-foreground" : "border-transparent")}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
