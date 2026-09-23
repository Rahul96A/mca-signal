import { Bot, Building2, Database, FlaskConical, Landmark } from "lucide-react";
import type { SourceCategory, ValueBasis } from "@/lib/domain/types";
import { Badge } from "./ui/primitives";

export const SOURCE_LABEL: Record<SourceCategory, string> = {
  official_government: "Official Government Data",
  third_party: "Third-Party Aggregated Data",
  demo: "Demo Data",
  ai_derived: "AI-Derived Analysis",
};

export function SourceBadge({ category, short, title }: { category: SourceCategory; short?: boolean; title?: string }) {
  const map = {
    official_government: { tone: "success" as const, icon: Landmark, s: "Official" },
    third_party: { tone: "warning" as const, icon: Building2, s: "Third-party" },
    demo: { tone: "violet" as const, icon: FlaskConical, s: "Demo" },
    ai_derived: { tone: "info" as const, icon: Bot, s: "AI-derived" },
  }[category] ?? { tone: "neutral" as const, icon: Database, s: category };
  const Icon = map.icon;
  return (
    <Badge tone={map.tone} title={title ?? SOURCE_LABEL[category]}>
      <Icon className="size-3" />
      {short ? map.s : SOURCE_LABEL[category]}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge>Status unknown</Badge>;
  const s = status.toLowerCase();
  const tone = s.startsWith("active") ? "success" : /strike|struck|dissolved|liquidat|amalgamat/.test(s) ? "danger" : "warning";
  return <Badge tone={tone}>{status}</Badge>;
}

export function BasisBadge({ basis, formula }: { basis: ValueBasis | null; formula?: string }) {
  if (!basis) return null;
  const map = { reported: { tone: "neutral" as const, t: "R" }, calculated: { tone: "info" as const, t: "C" }, derived: { tone: "violet" as const, t: "D" } };
  const title = basis === "reported" ? "Reported — as filed/provided by source" : basis === "calculated" ? `Calculated — ${formula ?? "from reported values"}` : "Estimated/Derived";
  return (
    <Badge tone={map[basis].tone} className="px-1.5 font-mono" title={title}>
      {map[basis].t}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: "info" | "review" | "attention" }) {
  if (severity === "attention") return <Badge tone="danger">Priority review</Badge>;
  if (severity === "review") return <Badge tone="warning">Potential review item</Badge>;
  return <Badge tone="info">Information</Badge>;
}
