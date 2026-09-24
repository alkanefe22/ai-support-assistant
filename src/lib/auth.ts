import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getConfig } from "./config";

const COOKIE = "aisa_admin";
const TTL_MS = 12 * 60 * 60 * 1000;

export type AuthMode = "open-demo" | "password" | "locked";

/** What the current visitor may do in the admin panel. */
export type Access = "full" | "readonly" | "none";

export const READ_ONLY_MESSAGE = "Salt okunur demo: değişiklik, silme ve yükleme kapalı.";

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

/** PUBLIC_DEMO=true lets anyone browse the panel read-only (for a public portfolio deployment). */
export function isPublicDemo(): boolean {
  return process.env.PUBLIC_DEMO === "true";
}

/**
 * Pure access decision (unit-tested):
 * - a logged-in owner always gets full access;
 * - on a public demo everyone else is a read-only viewer, even when no password is set;
 * - otherwise the local open demo is fully writable and everything else is closed.
 */
export function resolveAccess(o: { mode: AuthMode; publicDemo: boolean; sessionValid: boolean }): Access {
  if (o.mode === "password" && o.sessionValid) return "full";
  if (o.publicDemo) return "readonly";
  if (o.mode === "open-demo") return "full";
  return "none";
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

async function sessionValid(): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value ?? "";
  const [exp, sig] = raw.split(".");
  if (!exp || !sig || !safeEqual(sig, sign(exp))) return false;
  return Number(exp) > Date.now();
}

export async function adminAccess(): Promise<Access> {
  const mode = authMode();
  return resolveAccess({
    mode,
    publicDemo: isPublicDemo(),
    sessionValid: mode === "password" && (await sessionValid()),
  });
}

/** Viewing is allowed (full or read-only). */
export async function isAdmin(): Promise<boolean> {
  return (await adminAccess()) !== "none";
}

/** Guard for admin pages: any access level may view. */
export async function requireAdmin() {
  if (!(await isAdmin())) redirect("/admin/login");
}

/**
 * Guard for every server action that changes data. Read-only viewers are sent back
 * to `backTo` with an explanation; the check runs on the server, so a disabled button
 * in the UI is only a hint, not the protection.
 */
export async function requireWrite(backTo: string) {
  const access = await adminAccess();
  if (access === "none") redirect("/admin/login");
  if (access === "readonly") redirect(`${backTo}?${new URLSearchParams({ error: READ_ONLY_MESSAGE })}`);
}
