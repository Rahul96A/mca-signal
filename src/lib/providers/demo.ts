import { config } from "../config";
import { DEMO_BUNDLES } from "../demo/dataset";
import { normalizeName } from "../identifiers";
import { SOURCES } from "./sources";
import type { DataProvider, ProviderSearchHit } from "./types";

/** Serves the bundled fictional dataset. Same contract as live providers. */
export class DemoProvider implements DataProvider {
  readonly source = SOURCES.demo;
  readonly capabilities = {
    masterData: true,
    nameSearch: "fuzzy" as const,
    directors: true,
    filings: true,
    financials: true,
    charges: true,
    directorLookup: true,
    bulkSync: false,
  };

  isConfigured() {
    return config.dataMode === "demo";
  }

  async fetchEntity(identifier: string) {
    return DEMO_BUNDLES.find((b) => b.entity?.identifier === identifier) ?? null;
  }

  async search(query: string, limit: number): Promise<ProviderSearchHit[]> {
    const q = normalizeName(query);
    return DEMO_BUNDLES.filter((b) => b.entity && normalizeName(b.entity.name).includes(q))
      .slice(0, limit)
      .map((b) => ({ kind: b.entity!.kind, identifier: b.entity!.identifier, name: b.entity!.name, status: b.entity!.status, state: b.entity!.state }));
  }
}
