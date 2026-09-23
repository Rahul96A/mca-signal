/** Minimal structured JSON logger (stdout), level-filtered via LOG_LEVEL. */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const l = (process.env.LOG_LEVEL || "info").toLowerCase() as Level;
  return ORDER[l] ?? ORDER.info;
}

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
  child(base: Record<string, unknown>) {
    return {
      debug: (m: string, meta?: Record<string, unknown>) => emit("debug", m, { ...base, ...meta }),
      info: (m: string, meta?: Record<string, unknown>) => emit("info", m, { ...base, ...meta }),
      warn: (m: string, meta?: Record<string, unknown>) => emit("warn", m, { ...base, ...meta }),
      error: (m: string, meta?: Record<string, unknown>) => emit("error", m, { ...base, ...meta }),
    };
  },
};

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
