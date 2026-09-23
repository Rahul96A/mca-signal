/**
 * Provider registry. The service layer asks for "the configured providers" in priority order and
 * never knows which concrete sources exist — swap/add providers here without touching the frontend.
 * Priority: Official Government → Third-Party → Demo.
 */
import { config } from "../config";
import { AttestrProvider } from "./attestr";
import { DataGovProvider } from "./datagov";
import { DemoProvider } from "./demo";
import { Probe42Provider } from "./probe42";
import { ThirdPartyMcaProvider } from "./thirdparty";
import type { DataProvider } from "./types";

let providers: DataProvider[] | null = null;

export function allProviders(): DataProvider[] {
  if (!providers) providers = [new DataGovProvider(), new AttestrProvider(), new Probe42Provider(), new ThirdPartyMcaProvider(), new DemoProvider()];
  return providers;
}

/** Live (non-demo) providers that are configured. Empty in demo mode. */
export function liveProviders(): DataProvider[] {
  if (config.dataMode === "demo") return [];
  return allProviders().filter((p) => p.source.category !== "demo" && p.isConfigured());
}

export function providerStatus() {
  return allProviders().map((p) => ({
    id: p.source.id,
    name: p.source.name,
    category: p.source.category,
    configured: p.isConfigured(),
    capabilities: p.capabilities,
  }));
}

/** Test hook. */
export function setProvidersForTesting(list: DataProvider[] | null) {
  providers = list;
}
