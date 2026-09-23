"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api-client";
import type { Overview } from "@/lib/services/overview";

export function useCompanyQuery<T>(identifier: string, path: string, key: unknown[] = []) {
  return useQuery({
    queryKey: ["company", identifier, path, ...key],
    queryFn: () => api<T>(`/api/companies/${encodeURIComponent(identifier)}${path}`),
  });
}

export function useOverview(identifier: string) {
  return useCompanyQuery<Overview>(identifier, "");
}
