import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    pool: "forks",
    env: { DATA_MODE: "demo", PGLITE_DATA_DIR: "memory://", LOG_LEVEL: "error", AUTH_SECRET: "test-secret-test-secret-test-secret-123" },
  },
});
