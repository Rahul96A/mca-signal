/**
 * Basic email/password authentication. Passwords are bcrypt-hashed; sessions are HS256 JWTs in an
 * httpOnly, SameSite=Lax cookie. Only the watchlist requires sign-in; research pages are public.
 */
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { config } from "./config";
import { getDb } from "./db/client";
import { AppError, UnauthorizedError, ValidationError } from "./services/errors";

export const SESSION_COOKIE = "mca_session";
const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

const key = () => new TextEncoder().encode(config.authSecret);

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key());
}

export async function verifySessionToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return { id: String(payload.sub), email: String(payload.email), name: (payload.name as string) ?? null };
  } catch {
    return null;
  }
}

export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  return verifySessionToken(readCookie(req, SESSION_COOKIE));
}

export async function requireUser(req: Request): Promise<SessionUser> {
  const u = await getSessionUser(req);
  if (!u) throw new UnauthorizedError();
  return u;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function registerUser(email: string, password: string, name?: string): Promise<SessionUser> {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw new ValidationError("Enter a valid email address");
  if (password.length < 8) throw new ValidationError("Password must be at least 8 characters");
  const db = await getDb();
  const hash = await bcrypt.hash(password, 10);
  const rows = await db.query<{ id: string; email: string; name: string | null }>(
    `insert into users (email, name, password_hash) values ($1,$2,$3) on conflict (email) do nothing returning id, email, name`,
    [e, name?.trim() || null, hash],
  );
  if (!rows[0]) throw new AppError("conflict", "An account with this email already exists", 409);
  return rows[0];
}

export async function authenticate(email: string, password: string): Promise<SessionUser> {
  const db = await getDb();
  const rows = await db.query<{ id: string; email: string; name: string | null; password_hash: string }>(`select * from users where email = $1`, [email.trim().toLowerCase()]);
  const u = rows[0];
  // Always run bcrypt to keep timing uniform whether or not the user exists.
  const ok = await bcrypt.compare(password, u?.password_hash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali");
  if (!u || !ok) throw new AppError("invalid_credentials", "Invalid email or password", 401);
  return { id: u.id, email: u.email, name: u.name };
}
