import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { authenticate, createSessionToken, sessionCookie } from "@/lib/auth";
import { ValidationError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export const POST = route(
  async (req) => {
    const body = (await req.json().catch(() => null)) as { email?: string; password?: string } | null;
    if (!body?.email || !body.password) throw new ValidationError("Email and password are required");
    const user = await authenticate(body.email, body.password);
    const res = NextResponse.json({ data: user });
    res.cookies.set(sessionCookie(await createSessionToken(user)));
    return res;
  },
  { rateLimit: 10 },
);
