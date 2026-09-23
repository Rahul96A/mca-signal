/**
 * Next.js 16 proxy (formerly middleware): redirects unauthenticated visitors away from pages that
 * require an account. API routes enforce auth themselves (requireUser) and return 401 JSON.
 */
import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PROTECTED = ["/watchlist"];

function secret() {
  const s = process.env.AUTH_SECRET ?? "";
  return new TextEncoder().encode(s.length >= 32 ? s : "dev-only-insecure-secret-change-me-0123456789");
}

export async function proxy(req: NextRequest) {
  if (!PROTECTED.some((p) => req.nextUrl.pathname.startsWith(p))) return NextResponse.next();
  const token = req.cookies.get("mca_session")?.value;
  if (token) {
    try {
      await jwtVerify(token, secret(), { algorithms: ["HS256"] });
      return NextResponse.next();
    } catch {
      /* fall through to redirect */
    }
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/watchlist/:path*"] };
