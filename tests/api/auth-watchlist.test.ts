import { describe, expect, it } from "vitest";
import { call } from "./helpers";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as registerPOST } from "@/app/api/auth/register/route";
import { GET as meGET } from "@/app/api/auth/me/route";
import { GET as listGET, POST as addPOST } from "@/app/api/watchlist/route";
import { DELETE as removeDELETE } from "@/app/api/watchlist/[identifier]/route";

const json = (body: unknown, cookie?: string): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` },
  body: JSON.stringify(body),
});
const cookieFrom = (h: Headers) => (h.get("set-cookie") ?? "").split(";")[0];

describe("auth + watchlist", () => {
  it("rejects bad credentials and unauthenticated watchlist access", async () => {
    expect((await call(loginPOST, "/api/auth/login", {}, json({ email: "demo@mcasignal.local", password: "wrong-password" }))).status).toBe(401);
    expect((await call(listGET, "/api/watchlist")).status).toBe(401);
  });

  it("validates registration input and prevents duplicates", async () => {
    expect((await call(registerPOST, "/api/auth/register", {}, json({ email: "bad", password: "12345678" }))).status).toBe(400);
    expect((await call(registerPOST, "/api/auth/register", {}, json({ email: "x@y.in", password: "short" }))).status).toBe(400);
    expect((await call(registerPOST, "/api/auth/register", {}, json({ email: "analyst@example.in", password: "longpassword" }))).status).toBe(201);
    expect((await call(registerPOST, "/api/auth/register", {}, json({ email: "analyst@example.in", password: "longpassword" }))).status).toBe(409);
  });

  it("logs in the demo user and manages a watchlist", async () => {
    const login = await call(loginPOST, "/api/auth/login", {}, json({ email: "demo@mcasignal.local", password: "demo12345" }));
    expect(login.status).toBe(200);
    const cookie = cookieFrom(login.headers);
    expect(cookie).toMatch(/^mca_session=/);
    expect(login.headers.get("set-cookie")).toMatch(/HttpOnly/i);

    const me = await call(meGET, "/api/auth/me", {}, { headers: { cookie } });
    expect(me.body.data.email).toBe("demo@mcasignal.local");

    const added = await call(addPOST, "/api/watchlist", {}, json({ identifier: "zza-0001" }, cookie));
    expect(added.status).toBe(201);
    expect(added.body.data[0]).toMatchObject({ entityIdentifier: "ZZA-0001", entityKind: "llp", status: "Active" });

    const unknown = await call(addPOST, "/api/watchlist", {}, json({ identifier: "U99999MH2020PTC999999" }, cookie));
    expect(unknown.status).toBe(404);

    const removed = await call(removeDELETE, "/api/watchlist/ZZA-0001", { identifier: "ZZA-0001" }, { method: "DELETE", headers: { cookie } });
    expect(removed.body.data).toEqual([]);
  });

  it("rejects tampered session tokens", async () => {
    const me = await call(meGET, "/api/auth/me", {}, { headers: { cookie: "mca_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad" } });
    expect(me.body.data).toBeNull();
  });
});
