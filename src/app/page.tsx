import Link from "next/link";
import { Bot, Building2, FileClock, Landmark, Network, ShieldCheck } from "lucide-react";
import { SearchBox } from "@/components/search/search-box";
import { RecentAndSamples } from "@/components/search/recent-and-samples";
import { Card } from "@/components/ui/primitives";
import { SourceBadge } from "@/components/badges";

const FEATURES = [
  { icon: Building2, title: "Company & LLP profiles", body: "Status, class, ROC, capital, registered office, age, name history — with source and freshness on every field." },
  { icon: FileClock, title: "Filing timelines", body: "AOC-4, MGT-7/7A, DIR-12, PAS-3, CHG-1/4, ADT-1, LLP Form 8/11 with delay detection against due dates." },
  { icon: Landmark, title: "Financials & charges", body: "Revenue, profit, EBITDA, net worth, borrowings, YoY and CAGR — each labelled Reported, Calculated or Derived." },
  { icon: Network, title: "Director network", body: "Company → Director → other companies → LLPs graph, common directors and connected-entity status." },
  { icon: ShieldCheck, title: "Due-diligence signals", body: "Neutral, evidence-linked review items: status, filing gaps, frequent board or office changes, open charges." },
  { icon: Bot, title: "Cited AI report", body: "12-section report where every statement references the underlying record. Export to PDF/CSV or share a link." },
];

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="mx-auto max-w-3xl space-y-5 pt-6 text-center sm:pt-12">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Indian company intelligence, with provenance</h1>
        <p className="text-muted-foreground">
          Research private limited companies and LLPs from official Ministry of Corporate Affairs data. Every value shows where it came from and when.
        </p>
        <SearchBox large />
        <div className="flex flex-wrap justify-center gap-2">
          <SourceBadge category="official_government" />
          <SourceBadge category="third_party" />
          <SourceBadge category="ai_derived" />
          <SourceBadge category="demo" />
        </div>
        <p className="text-xs text-muted-foreground">
          Press <kbd className="rounded border bg-muted px-1 font-mono">Ctrl K</kbd> anywhere to search.
        </p>
      </section>

      <RecentAndSamples />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <Card key={f.title} className="p-5">
            <f.icon className="size-5 text-primary" />
            <h2 className="mt-3 text-sm font-semibold">{f.title}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.body}</p>
          </Card>
        ))}
      </section>

      <p className="text-center text-xs text-muted-foreground">
        See <Link href="/sources" className="text-primary hover:underline">data sources &amp; sync status</Link> for exactly what each provider supplies and its licence.
      </p>
    </div>
  );
}
