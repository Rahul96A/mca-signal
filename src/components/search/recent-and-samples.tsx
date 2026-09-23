"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Clock, Sparkles } from "lucide-react";
import { api } from "@/lib/client/api-client";
import { useRecentSearches } from "@/lib/client/hooks";
import { titleCase } from "@/lib/format";
import { Button, Card, CardContent, CardHeader, CardTitle } from "../ui/primitives";
import { hrefFor, TypeIcon } from "../layout/command-bar";

interface SourcesMeta {
  counts: { companies: number; llps: number; directors: number; filings: number };
}

const DEMO_SAMPLES = [
  { identifier: "U01403KA2014PTC999101", name: "Aarohan Agritech Private Limited", note: "Growing, secured borrowing" },
  { identifier: "U63090MH2011PTC999102", name: "Brightwave Logistics Private Limited", note: "Late filings, board changes" },
  { identifier: "U45200DL2009PTC999105", name: "Everstone Realty Developers Private Limited", note: "Large open charges" },
  { identifier: "U15400TG2012PTC999104", name: "Deccan Pure Foods Private Limited", note: "Struck off" },
  { identifier: "ZZA-0001", name: "Indus Advisory Partners LLP", note: "LLP, shared partners" },
  { identifier: "ZZA-0002", name: "Jaipur Heritage Crafts LLP", note: "Filings missing" },
];

export function RecentAndSamples() {
  const recent = useRecentSearches();
  const envelope = useQuery({ queryKey: ["meta"], queryFn: () => api<SourcesMeta>("/api/meta/sources") });
  const meta = { data: envelope.data?.data };
  const isDemo = { data: envelope.data?.meta.dataMode === "demo" };

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> {isDemo.data ? "Demo companies (fictional)" : "Try an identifier"}</CardTitle>
        </CardHeader>
        <CardContent>
          {isDemo.data ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {DEMO_SAMPLES.map((s) => (
                <li key={s.identifier}>
                  <Link href={`/company/${s.identifier}`} className="block rounded-lg border p-3 hover:bg-muted">
                    <p className="text-sm font-medium">{s.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{s.identifier}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{s.note}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Enter a 21-character CIN (e.g. <span className="font-mono">U72900KA2015PTC012345</span>) or LLPIN (e.g. <span className="font-mono">AAB-1234</span>). Records not yet in the local database are fetched live from configured providers.
            </p>
          )}
          {meta.data && (
            <p className="mt-4 text-xs text-muted-foreground">
              Local database: {meta.data.counts.companies.toLocaleString("en-IN")} companies · {meta.data.counts.llps.toLocaleString("en-IN")} LLPs · {meta.data.counts.directors.toLocaleString("en-IN")} directors · {meta.data.counts.filings.toLocaleString("en-IN")} filings
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Clock className="size-4 text-muted-foreground" /> Recent searches</CardTitle>
          {recent.items.length > 0 && <Button variant="ghost" size="sm" onClick={recent.clear}>Clear</Button>}
        </CardHeader>
        <CardContent>
          {recent.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">Companies you open will appear here (stored only in this browser).</p>
          ) : (
            <ul className="space-y-1">
              {recent.items.map((r) => (
                <li key={r.identifier}>
                  <Link href={hrefFor(r)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                    <TypeIcon type={r.type} />
                    <span className="flex-1 truncate">{titleCase(r.name)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
