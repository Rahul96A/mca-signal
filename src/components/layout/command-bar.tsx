"use client";
/** Global search command bar (Ctrl/⌘ + K): debounced suggestions, recent searches, identifier jump. */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Building2, Clock, Handshake, Loader2, Search, User } from "lucide-react";
import { api } from "@/lib/client/api-client";
import { useDebounce, useRecentSearches } from "@/lib/client/hooks";
import type { SearchResult } from "@/lib/domain/types";
import { titleCase } from "@/lib/format";
import { SourceBadge, StatusBadge } from "../badges";

export function hrefFor(r: { type: string; identifier: string }) {
  return r.type === "director" ? `/director/${r.identifier}` : `/company/${encodeURIComponent(r.identifier)}`;
}

export const TypeIcon = ({ type }: { type: string }) =>
  type === "director" ? <User className="size-4 text-muted-foreground" /> : type === "llp" ? <Handshake className="size-4 text-muted-foreground" /> : <Building2 className="size-4 text-muted-foreground" />;

export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const debounced = useDebounce(q.trim(), 200);
  const router = useRouter();
  const recent = useRecentSearches();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mca:open-command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mca:open-command", onOpen);
    };
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ["suggest", debounced],
    queryFn: async () => (await api<SearchResult[]>(`/api/search?q=${encodeURIComponent(debounced)}&pageSize=8&remote=0`)).data,
    enabled: debounced.length >= 2,
    staleTime: 60_000,
  });

  const go = (r: { type: SearchResult["type"]; identifier: string; name: string }) => {
    recent.add({ identifier: r.identifier, name: r.name, type: r.type });
    setOpen(false);
    setQ("");
    router.push(hrefFor(r));
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border bg-card shadow-2xl">
          <Dialog.Title className="sr-only">Search companies, LLPs and directors</Dialog.Title>
          <Dialog.Description className="sr-only">Type a company name, CIN, LLPIN, DIN or director name</Dialog.Description>
          <Command shouldFilter={false} label="Search">
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="size-4 text-muted-foreground" />
              <Command.Input
                value={q}
                onValueChange={setQ}
                autoFocus
                placeholder="Company name, CIN, LLPIN, DIN or director…"
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && q.trim().length >= 2 && !data?.length) {
                    setOpen(false);
                    router.push(`/search?q=${encodeURIComponent(q.trim())}`);
                  }
                }}
              />
              {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-2">
              {debounced.length >= 2 && !isFetching && data?.length === 0 && (
                <Command.Empty className="p-6 text-center text-sm text-muted-foreground">No local matches for “{debounced}”. Press Enter to search the official register.</Command.Empty>
              )}
              {debounced.length < 2 && recent.items.length > 0 && (
                <Command.Group heading="Recent" className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                  {recent.items.map((r) => (
                    <Command.Item
                      key={r.identifier}
                      value={`recent-${r.identifier}`}
                      onSelect={() => go(r)}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-foreground data-[selected=true]:bg-muted"
                    >
                      <Clock className="size-4 text-muted-foreground" />
                      <span className="flex-1 truncate">{titleCase(r.name)}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{r.identifier}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {data && data.length > 0 && (
                <Command.Group heading="Results" className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                  {data.map((r) => (
                    <Command.Item
                      key={`${r.type}-${r.identifier}`}
                      value={`${r.type}-${r.identifier}`}
                      onSelect={() => go(r)}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-foreground data-[selected=true]:bg-muted"
                    >
                      <TypeIcon type={r.type} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{titleCase(r.name)}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {r.type === "director" ? `DIN ${r.identifier}` : r.identifier}
                          {r.state ? ` · ${r.state}` : ""}
                        </div>
                      </div>
                      {r.type !== "director" && <StatusBadge status={r.status} />}
                      <SourceBadge category={r.sourceCategory} short />
                    </Command.Item>
                  ))}
                  <Command.Item
                    value="see-all"
                    onSelect={() => {
                      setOpen(false);
                      router.push(`/search?q=${encodeURIComponent(debounced)}`);
                    }}
                    className="mt-1 cursor-pointer rounded-md px-2 py-2 text-center text-xs text-primary data-[selected=true]:bg-muted"
                  >
                    Search all sources (incl. live official register) for “{debounced}”
                  </Command.Item>
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
