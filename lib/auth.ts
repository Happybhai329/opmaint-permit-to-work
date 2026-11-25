import { cookies } from "next/headers";
import { getEnv } from "./db";

export type Role = "REQUESTER" | "AREA_OWNER" | "SAFETY_OFFICER" | "ADMIN";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  areaId: string | null;
  plantId: string | null;
};

const COOKIE = "ptw_session";
const SESSION_DAYS = 7;

/* ---------------------------------- hashing --------------------------------- */

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes.buffer as ArrayBuffer;
}

/**
 * PBKDF2 via WebCrypto: available in workerd and Node without a native
 * dependency, which matters because the deployed runtime is a Worker.
 */
export async function hashPassword(password: string, saltHex?: string): Promise<string> {
  const salt = saltHex ?? toHex(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(salt), iterations: 100_000 },
    key,
    256,
  );
  return `pbkdf2$${salt}$${toHex(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, expected] = stored.split("$");
  if (!salt || !expected) return false;
  const candidate = await hashPassword(password, salt);
  return timingSafeEqual(candidate, stored);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* --------------------------------- sessions -------------------------------- */

async function hmacKey(): Promise<CryptoKey> {
  const env = await getEnv();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(env.SESSION_SECRET ?? "dev-only-secret-change-me-in-production"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function base64Url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  const payload = base64Url(
    JSON.stringify({
      sub: user.id,
      role: user.role,
      exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
    }),
  );
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(payload));
  return `${payload}.${toHex(signature)}`;
}

export async function readSessionToken(token: string): Promise<{ sub: string; role: Role } | null> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      fromHex(signature),
      encoder.encode(payload),
    );
    if (!valid) return null;
    const data = JSON.parse(fromBase64Url(payload)) as { sub: string; role: Role; exp: number };
    if (!data.exp || data.exp < Date.now()) return null;
    return { sub: data.sub, role: data.role };
  } catch {
    return null;
  }
}

export async function setSessionCookie(user: SessionUser): Promise<void> {
  const token = await createSessionToken(user);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** Resolves the signed-in user from the cookie on every call — never trusts a body. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await readSessionToken(token);
  if (!session) return null;

  const { db } = await import("./db");
  const handle = await db();
  const row = await handle
    .prepare("SELECT id, email, name, role, area_id, plant_id FROM users WHERE id = ?")
    .bind(session.sub)
    .first<{
      id: string;
      email: string;
      name: string;
      role: Role;
      area_id: string | null;
      plant_id: string | null;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    areaId: row.area_id,
    plantId: row.plant_id,
  };
}

export const ROLE_LABELS: Record<Role, string> = {
  REQUESTER: "Requester",
  AREA_OWNER: "Area Owner",
  SAFETY_OFFICER: "Safety Officer",
  ADMIN: "Admin",
};
