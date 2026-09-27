/**
 * Production refuses to boot with weak or missing admin credentials.
 *
 * SESSION_SECRET signs the admin cookie: a public or guessable value lets anyone
 * mint an admin session without the password. ADMIN_PASSWORD guards the panel;
 * without it a demo deployment would be writable by every visitor.
 */

export const MIN_SESSION_SECRET_LENGTH = 32;
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

/** Values that are public (code fallback, .env.example) and must never sign real sessions. */
export const KNOWN_INSECURE_SECRETS = ["dev-only-insecure-secret", "change-me-to-a-long-random-string"];

/** Pure check (unit-tested). Returns human-readable problems; empty means OK. */
export function productionEnvProblems(env: Record<string, string | undefined>): string[] {
  if (env.NODE_ENV !== "production") return [];
  const problems: string[] = [];

  const secret = env.SESSION_SECRET ?? "";
  if (!secret) problems.push("SESSION_SECRET is required in production (e.g. `openssl rand -hex 32`)");
  else if (KNOWN_INSECURE_SECRETS.includes(secret)) problems.push("SESSION_SECRET must not be a public example value");
  else if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    problems.push(`SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters in production`);
  }

  const password = env.ADMIN_PASSWORD ?? "";
  if (!password) problems.push("ADMIN_PASSWORD is required in production");
  else if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    problems.push(`ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters in production`);
  }

  return problems;
}
