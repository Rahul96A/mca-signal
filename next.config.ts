import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / WASM database drivers must be loaded from node_modules at runtime, not bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "ioredis", "jspdf", "jspdf-autotable"],
  poweredByHeader: false,
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
