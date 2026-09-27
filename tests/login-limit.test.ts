import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- Next.js request APIs, mocked so the real login server action runs inside Vitest ----
let clientIpHeader = "203.0.113.7";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ "x-forwarded-for": clientIpHeader }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { login } from "@/app/admin/actions";
import { LOGIN_ATTEMPTS } from "@/lib/ratelimit";

const fd = (password: string) => {
  const f = new FormData();
  f.set("password", password);
  return f;
};
const run = async (password: string) => {
  try {
    await login(fd(password));
    return "no redirect";
  } catch (e) {
    return String((e as Error).message).replace("REDIRECT:", "");
  }
};

describe("admin login rate limit", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD", "correct-horse-battery");
    delete (globalThis as { __loginLimiter?: unknown }).__loginLimiter;
    clientIpHeader = "203.0.113.7";
  });
  afterEach(() => vi.unstubAllEnvs());

  it(`allows ${LOGIN_ATTEMPTS} attempts per window, then blocks even the right password`, async () => {
    for (let i = 0; i < LOGIN_ATTEMPTS; i++) expect(await run("wrong")).toBe("/admin/login?error=1");
    expect(await run("wrong")).toMatch(/^\/admin\/login\?error=rate&retry=[1-5]$/);
    // A correct guess after the limit must not get through either.
    expect(await run("correct-horse-battery")).toMatch(/error=rate/);
  });

  it("limits per client, so another IP can still log in", async () => {
    for (let i = 0; i <= LOGIN_ATTEMPTS; i++) await run("wrong");
    clientIpHeader = "198.51.100.23";
    expect(await run("correct-horse-battery")).toBe("/admin");
  });
});
