/**
 * Live-mode pipeline with a stubbed provider (no network): identifier → provider fetch →
 * normalisation → DB with provenance → API response; plus graceful failure handling.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "./helpers";
import { mapOgdRecord } from "@/lib/providers/datagov";
import { setProvidersForTesting } from "@/lib/providers/registry";
import { SOURCES } from "@/lib/providers/sources";
import type { DataProvider } from "@/lib/providers/types";
import { GET as companyGET } from "@/app/api/companies/[id]/route";
import { GET as searchGET } from "@/app/api/search/route";
import { getDb } from "@/lib/db/client";

let calls = 0;
const fakeOgd: DataProvider = {
  source: SOURCES.ogd,
  capabilities: { masterData: true, nameSearch: "exact", directors: false, filings: false, financials: false, charges: false, directorLookup: false, bulkSync: true },
  isConfigured: () => true,
  async fetchEntity(id) {
    calls++;
    if (id === "U52100HR2015OPC056314")
      return mapOgdRecord(
        { CIN: id, CompanyName: "COVEY RETAIL (OPC) PRIVATE LIMITED", CompanyStatus: "Strike Off", CompanyClass: "One Person Company", CompanyRegistrationdate_date: "2015-08-06", CompanyStateCode: "haryana", PaidupCapital: "100000.00", Registered_Office_Address: "H.NO. 284 DEFENCE COLONY,HISAR,Haryana,125001-India" },
        "2026-07-22T08:17:15Z",
      );
    if (id === "U00000DL2000PTC000001") throw new Error("upstream timeout");
    return null;
  },
};

describe("live provider pipeline", () => {
  beforeAll(async () => {
    await getDb(); // seed demo data first (DATA_MODE=demo), then switch to live
    process.env.DATA_MODE = "live";
    setProvidersForTesting([fakeOgd]);
  });
  afterAll(() => {
    process.env.DATA_MODE = "demo";
    setProvidersForTesting(null);
  });

  it("fetches an unknown CIN from the provider, stores it with provenance, and serves it", async () => {
    const r = await call(companyGET, "", { id: "U52100HR2015OPC056314" });
    expect(r.status).toBe(200);
    expect(r.body.meta.dataMode).toBe("live");
    const p = r.body.data.profile;
    expect(p).toMatchObject({ name: "COVEY RETAIL (OPC) PRIVATE LIMITED", status: "Strike Off", state: "Haryana" });
    expect(p.provenance).toMatchObject({ sourceId: "ogd_datagov", sourceCategory: "official_government", sourceRecordId: "U52100HR2015OPC056314" });
    expect(p.provenance.rawResponseHash).toMatch(/^[a-f0-9]{64}$/);
    expect(p.provenance.publishedAt).toContain("2026-07-22");
    // provider lacks filings/directors → sections reported as unavailable, not empty
    expect(r.body.data.counts.filings).toBeNull();
    expect(r.body.data.signals.map((s: { id: string }) => s.id)).toContain("filings-unavailable");

    const db = await getDb();
    const logs = await db.query<{ status: string }>(`select status from data_sync_logs where entity_identifier = $1`, ["U52100HR2015OPC056314"]);
    expect(logs.map((l) => l.status)).toContain("success");
  });

  it("is then found by local fuzzy search without calling the provider again", async () => {
    const before = calls;
    const r = await call(searchGET, "/api/search?q=covey%20retail");
    expect(r.body.data[0]).toMatchObject({ identifier: "U52100HR2015OPC056314", sourceCategory: "official_government" });
    expect(calls).toBe(before);
  });

  it("maps provider failures to 502 and logs the error", async () => {
    const r = await call(companyGET, "", { id: "U00000DL2000PTC000001" });
    expect(r.status).toBe(502);
    expect(r.body.error.code).toBe("upstream_unavailable");
    const db = await getDb();
    const logs = await db.query<{ status: string; error: string }>(`select status, error from data_sync_logs where entity_identifier = $1`, ["U00000DL2000PTC000001"]);
    expect(logs[0]).toMatchObject({ status: "error" });
    expect(logs[0].error).toContain("upstream timeout");
  });

  it("returns 404 when no provider knows the identifier", async () => {
    expect((await call(companyGET, "", { id: "U11111KA2011PTC111111" })).status).toBe(404);
  });
});
