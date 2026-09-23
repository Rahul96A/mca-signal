/**
 * Cache abstraction: Redis when REDIS_URL is configured, otherwise a bounded in-process LRU.
 * Redis failures degrade gracefully to "cache miss" — the cache must never break a request.
 */
import { config } from "./config";
import { logger, errorMessage } from "./logger";

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(pattern: string): Promise<void>;
}

class MemoryCache implements Cache {
  private store = new Map<string, { value: unknown; expires: number }>();
  constructor(private maxEntries = 2000) {}
  async get<T>(key: string) {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // refresh LRU position
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value as T;
  }
  async set<T>(key: string, value: T, ttlSeconds = config.cacheTtlSeconds) {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }
  async del(prefix: string) {
    for (const k of [...this.store.keys()]) if (k.startsWith(prefix)) this.store.delete(k);
  }
}

class RedisCache implements Cache {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  constructor(url: string) {
    // Lazy require so the dependency is optional at runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require("ioredis");
    this.client = new Redis(url, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: false });
    this.client.on("error", (e: Error) => logger.warn("redis error", { error: e.message }));
  }
  async get<T>(key: string) {
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch (e) {
      logger.warn("redis get failed", { key, error: errorMessage(e) });
      return undefined;
    }
  }
  async set<T>(key: string, value: T, ttlSeconds = config.cacheTtlSeconds) {
    try {
      await this.client.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (e) {
      logger.warn("redis set failed", { key, error: errorMessage(e) });
    }
  }
  async del(prefix: string) {
    try {
      const stream = this.client.scanStream({ match: `${prefix}*`, count: 200 });
      for await (const keys of stream) if (keys.length) await this.client.del(...keys);
    } catch (e) {
      logger.warn("redis del failed", { prefix, error: errorMessage(e) });
    }
  }
}

const g = globalThis as unknown as { __mcaCache?: Cache };

export function getCache(): Cache {
  if (!g.__mcaCache) {
    g.__mcaCache = config.redisUrl ? new RedisCache(config.redisUrl) : new MemoryCache();
  }
  return g.__mcaCache;
}

/** Read-through helper. */
export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const cache = getCache();
  const hit = await cache.get<T>(key);
  if (hit !== undefined) return hit;
  const value = await fn();
  if (value !== undefined && value !== null) await cache.set(key, value, ttlSeconds);
  return value;
}
