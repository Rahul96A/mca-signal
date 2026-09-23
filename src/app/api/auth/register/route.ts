import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { createSessionToken, registerUser, sessionCookie } from "@/lib/auth";
import { ValidationError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export const POST = route(
  async (req) => {
    const body = (await req.json().catch(() => null)) as { email?: string; password?: string; name?: string } | null;
    if (!body?.email || !body.password) throw new ValidationError("Email and password are required");
    const user = await registerUser(body.email, body.password, body.name);
    const res = NextResponse.json({ data: user }, { status: 201 });
    res.cookies.set(sessionCookie(await createSessionToken(user)));
    return res;
  },
  { rateLimit: 5 },
);
