/**
 * Centralised, server-only configuration. Never import this from client components:
 * it reads secrets from process.env.
 */

export type DataMode = "demo" | "live";

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? fallback : v.trim();
}
function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const config = {
  get dataGovApiKey() { return str("DATA_GOV_API_KEY"); },
  get dataGovResourceId() { return str("DATA_GOV_COMPANY_RESOURCE_ID", "4dbe5667-7b6b-41d7-82af-211562424d9a"); },
  get dataGovSyncStates() { return str("DATA_GOV_SYNC_STATES").split(",").map((s) => s.trim()).filter(Boolean); },
  get dataGovPageSize() { return num("DATA_GOV_PAGE_SIZE", 500); },

  get mcaProvider() { return str("MCA_PROVIDER", "generic") as "sandbox" | "generic" | "attestr" | "probe42"; },
  get mcaProviderBaseUrl() { return str("MCA_PROVIDER_BASE_URL"); },
  get mcaProviderApiKey() { return str("MCA_PROVIDER_API_KEY"); },
  get mcaProviderApiSecret() { return str("MCA_PROVIDER_API_SECRET"); },

  get databaseUrl() { return str("DATABASE_URL"); },
  get pgliteDataDir() { return str("PGLITE_DATA_DIR", ".data/pglite"); },
  get redisUrl() { return str("REDIS_URL"); },
  get cacheTtlSeconds() { return num("CACHE_TTL_SECONDS", 900); },
  get entityStaleHours() { return num("ENTITY_STALE_HOURS", 24); },

  get openaiApiKey() { return str("OPENAI_API_KEY"); },
  get openaiModel() { return str("OPENAI_MODEL", "gpt-4o-mini"); },

  get authSecret() {
    const s = str("AUTH_SECRET");
    if (s.length >= 32) return s;
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET must be set to at least 32 characters in production");
    }
    return "dev-only-insecure-secret-change-me-0123456789";
  },
  get adminToken() { return str("ADMIN_TOKEN"); },
  get logLevel() { return str("LOG_LEVEL", "info"); },
  get apiRateLimitPerMinute() { return num("API_RATE_LIMIT_PER_MINUTE", 120); },

  /** Resolved data mode: demo data is used only when no live provider is configured (or forced). */
  get dataMode(): DataMode {
    const m = str("DATA_MODE", "auto").toLowerCase();
    if (m === "demo") return "demo";
    if (m === "live") return "live";
    return this.dataGovApiKey || (this.mcaProviderApiKey && (this.mcaProviderBaseUrl || this.mcaProvider === "attestr" || this.mcaProvider === "probe42")) ? "live" : "demo";
  },
};
