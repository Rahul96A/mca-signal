"use client";
import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api-client";

export function useDebounce<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ── Recent searches (per browser, localStorage) ────────────────────────────
export interface RecentItem {
  identifier: string;
  name: string;
  type: "company" | "llp" | "director";
  at: number;
}
const RECENT_KEY = "mca-signal:recent";
const listeners = new Set<() => void>();
let recentCache: RecentItem[] | null = null;

function readRecent(): RecentItem[] {
  if (recentCache) return recentCache;
  try {
    recentCache = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    recentCache = [];
  }
  return recentCache!;
}
const EMPTY: RecentItem[] = [];

export function useRecentSearches() {
  const items = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readRecent,
    () => EMPTY,
  );
  const add = useCallback((item: Omit<RecentItem, "at">) => {
    const next = [{ ...item, at: Date.now() }, ...readRecent().filter((r) => r.identifier !== item.identifier)].slice(0, 8);
    recentCache = next;
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {}
    listeners.forEach((l) => l());
  }, []);
  const clear = useCallback(() => {
    recentCache = [];
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch {}
    listeners.forEach((l) => l());
  }, []);
  return { items, add, clear };
}

// ── Session / watchlist ────────────────────────────────────────────────────
export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}
export function useSession() {
  return useQuery({ queryKey: ["me"], queryFn: async () => (await api<SessionUser | null>("/api/auth/me")).data, staleTime: 60_000 });
}

export interface WatchItem {
  id: string;
  entityKind: "company" | "llp";
  entityIdentifier: string;
  entityName: string;
  note: string | null;
  createdAt: string;
  status: string | null;
}
export function useWatchlist(enabled: boolean) {
  return useQuery({ queryKey: ["watchlist"], queryFn: async () => (await api<WatchItem[]>("/api/watchlist")).data, enabled });
}
export function useWatchlistMutations() {
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: async (identifier: string) => (await api<WatchItem[]>("/api/watchlist", { method: "POST", body: JSON.stringify({ identifier }) })).data,
    onSuccess: (data) => qc.setQueryData(["watchlist"], data),
  });
  const remove = useMutation({
    mutationFn: async (identifier: string) => (await api<WatchItem[]>(`/api/watchlist/${encodeURIComponent(identifier)}`, { method: "DELETE" })).data,
    onSuccess: (data) => qc.setQueryData(["watchlist"], data),
  });
  return { add, remove };
}
