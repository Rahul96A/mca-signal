"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { detectIdentifier } from "@/lib/identifiers";
import { Button, Input } from "../ui/primitives";

/** Inline search form. Exact identifiers jump straight to the profile. */
export function SearchBox({ initial = "", large }: { initial?: string; large?: boolean }) {
  const [q, setQ] = useState(initial);
  const router = useRouter();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (v.length < 2) return;
    const id = detectIdentifier(v);
    if (id.kind === "cin" || id.kind === "llpin") router.push(`/company/${id.value}`);
    else if (id.kind === "din") router.push(`/director/${id.value}`);
    else router.push(`/search?q=${encodeURIComponent(v)}`);
  };
  return (
    <form onSubmit={submit} className="flex w-full gap-2" role="search">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Company name, CIN, LLPIN, DIN or director name"
          className={large ? "h-12 pl-9 text-base" : "pl-9"}
          aria-label="Search query"
        />
      </div>
      <Button type="submit" size={large ? "lg" : "default"}>
        Search
      </Button>
    </form>
  );
}
