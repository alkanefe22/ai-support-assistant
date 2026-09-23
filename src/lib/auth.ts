import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getConfig } from "./config";

const COOKIE = "aisa_admin";
const TTL_MS = 12 * 60 * 60 * 1000;

export type AuthMode = "open-demo" | "password" | "locked";

/**
 * - password: ADMIN_PASSWORD is set → login required.
 * - open-demo: no password and demo provider → panel open (local portfolio demo).
 * - locked: live provider without a password → refuse, never expose a paid backend.
 */
export function authMode(): AuthMode {
  const cfg = getConfig();
  if (cfg.adminPassword) return "password";
  return cfg.provider === "demo" ? "open-demo" : "locked";
}

function sign(value: string): string {
  return createHmac("sha256", getConfig().sessionSecret).update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkPassword(input: string): boolean {
  const pw = getConfig().adminPassword;
  return !!pw && safeEqual(sign(input), sign(pw));
}

export async function createSession() {
  const exp = String(Date.now() + TTL_MS);
  (await cookies()).set(COOKIE, `${exp}.${sign(exp)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_MS / 1000,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  const mode = authMode();
  if (mode === "open-demo") return true;
  if (mode === "locked") return false;
  const raw = (await cookies()).get(COOKIE)?.value ?? "";
  const [exp, sig] = raw.split(".");
  if (!exp || !sig || !safeEqual(sig, sign(exp))) return false;
  return Number(exp) > Date.now();
}

/** Guard for admin pages and server actions. */
export async function requireAdmin() {
  if (!(await isAdmin())) redirect("/admin/login");
}
