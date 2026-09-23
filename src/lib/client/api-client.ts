"use client";
/** Typed browser → backend API client. Only talks to our own /api routes; never to providers. */
import type { ApiMeta } from "@/lib/domain/types";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
  }
}

export interface Envelope<T> {
  data: T;
  meta: ApiMeta;
}

export async function api<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(body?.error?.message ?? `Request failed (${res.status})`, res.status, body?.error?.code ?? "error");
  }
  return body as Envelope<T>;
}

/** React Query retry policy: don't retry 4xx (except 429), retry network/5xx up to 2 times. */
export function shouldRetry(failureCount: number, error: unknown) {
  if (error instanceof ApiError && error.status < 500 && error.status !== 429) return false;
  return failureCount < 2;
}
