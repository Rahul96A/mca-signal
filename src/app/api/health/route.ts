import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    await db.query("select 1");
    return NextResponse.json({ status: "ok", database: db.driver, dataMode: config.dataMode });
  } catch (e) {
    return NextResponse.json({ status: "error", message: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
