/**
 * Outbound HTTP with timeouts, retries (exponential backoff + jitter), Retry-After support
 * and a per-host minimum interval so we stay inside provider rate limits.
 */
import { logger } from "./logger";

export class UpstreamError extends Error {
  constructor(message: string, public status: number, public url: string, public body?: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface FetchRetryOptions extends RequestInit {
  retries?: number;
  timeoutMs?: number;
  /** Minimum spacing between requests to the same host (ms). */
  minIntervalMs?: number;
}

const lastCallByHost = new Map<string, number>();
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function throttle(host: string, minIntervalMs: number) {
  if (!minIntervalMs) return;
  const last = lastCallByHost.get(host) ?? 0;
  const wait = last + minIntervalMs - Date.now();
  lastCallByHost.set(host, Math.max(Date.now(), last + minIntervalMs));
  if (wait > 0) await sleep(wait);
}

export function backoffDelay(attempt: number, retryAfterHeader?: string | null): number {
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    if (Number.isFinite(secs)) return Math.min(secs * 1000, 60_000);
    const date = Date.parse(retryAfterHeader);
    if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), 60_000);
  }
  const base = 500 * 2 ** attempt;
  return Math.min(base + Math.random() * base * 0.3, 15_000);
}

export async function fetchWithRetry(url: string, opts: FetchRetryOptions = {}): Promise<Response> {
  const { retries = 3, timeoutMs = 20_000, minIntervalMs = 0, ...init } = opts;
  const host = new URL(url).host;
  const safeUrl = url.replace(/(api-key|apikey|token)=[^&]+/gi, "$1=***");
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host, minIntervalMs);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return res;
      const body = await res.text().catch(() => "");
      if (RETRYABLE.has(res.status) && attempt < retries) {
        const delay = backoffDelay(attempt, res.headers.get("retry-after"));
        logger.warn("upstream retry", { url: safeUrl, status: res.status, attempt, delay });
        await sleep(delay);
        continue;
      }
      throw new UpstreamError(`Upstream ${res.status} for ${host}`, res.status, safeUrl, body.slice(0, 500));
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof UpstreamError) throw e;
      lastErr = e;
      if (attempt < retries) {
        const delay = backoffDelay(attempt);
        logger.warn("upstream network retry", { url: safeUrl, attempt, delay, error: String(e) });
        await sleep(delay);
        continue;
      }
    }
  }
  throw new UpstreamError(`Upstream request failed for ${host}: ${String(lastErr)}`, 0, safeUrl);
}
