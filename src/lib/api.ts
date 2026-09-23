/** Route-handler wrapper: rate limiting, error mapping, structured logging, response envelope. */
import { NextResponse } from "next/server";
import { config } from "./config";
import { logger, errorMessage } from "./logger";
import { AppError } from "./services/errors";
import type { ApiMeta } from "./domain/types";

// Fixed-window per-client limiter (per process). Put a gateway/Redis limiter in front for multi-instance deployments.
const windows = new Map<string, { start: number; count: number }>();

export function checkRateLimit(clientKey: string, limit = config.apiRateLimitPerMinute, now = Date.now()) {
  const w = windows.get(clientKey);
  if (!w || now - w.start >= 60_000) {
    windows.set(clientKey, { start: now, count: 1 });
    if (windows.size > 10_000) for (const [k, v] of windows) if (now - v.start >= 60_000) windows.delete(k);
    return { ok: true, remaining: limit - 1, resetMs: 60_000 };
  }
  w.count++;
  return { ok: w.count <= limit, remaining: Math.max(0, limit - w.count), resetMs: 60_000 - (now - w.start) };
}

function clientKey(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

export function meta(extra: Partial<ApiMeta> = {}): ApiMeta {
  return { dataMode: config.dataMode, generatedAt: new Date().toISOString(), ...extra };
}

export function ok<T>(data: T, m: Partial<ApiMeta> = {}, init?: ResponseInit) {
  return NextResponse.json({ data, meta: meta(m) }, init);
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  logger.error("unhandled api error", { error: errorMessage(e), stack: e instanceof Error ? e.stack : undefined });
  return NextResponse.json({ error: { code: "internal_error", message: "An unexpected error occurred" } }, { status: 500 });
}

type Ctx<P> = { params: Promise<P> };

export function route<P = Record<string, string>>(fn: (req: Request, params: P) => Promise<Response>, opts: { rateLimit?: number } = {}) {
  return async (req: Request, ctx: Ctx<P>) => {
    const started = Date.now();
    const rl = checkRateLimit(clientKey(req), opts.rateLimit);
    if (!rl.ok) {
      return NextResponse.json(
        { error: { code: "rate_limited", message: "Too many requests — please retry shortly" } },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } },
      );
    }
    let res: Response;
    try {
      res = await fn(req, (await ctx?.params) ?? ({} as P));
    } catch (e) {
      res = errorResponse(e);
    }
    res.headers.set("X-RateLimit-Remaining", String(rl.remaining));
    logger.info("api", { method: req.method, path: new URL(req.url).pathname, status: res.status, ms: Date.now() - started });
    return res;
  };
}

export function intParam(url: URL, name: string, fallback: number) {
  const v = Number(url.searchParams.get(name));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}
