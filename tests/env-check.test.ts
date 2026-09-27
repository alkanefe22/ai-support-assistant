import { describe, expect, it } from "vitest";
import { KNOWN_INSECURE_SECRETS, productionEnvProblems } from "@/lib/env-check";

const GOOD = {
  NODE_ENV: "production",
  SESSION_SECRET: "a".repeat(64),
  ADMIN_PASSWORD: "a-long-enough-password",
};

describe("productionEnvProblems", () => {
  it("accepts strong credentials in production", () => {
    expect(productionEnvProblems(GOOD)).toEqual([]);
  });

  it("does not enforce anything outside production (local open demo keeps working)", () => {
    expect(productionEnvProblems({ NODE_ENV: "development" })).toEqual([]);
    expect(productionEnvProblems({ NODE_ENV: "test" })).toEqual([]);
  });

  it.each([
    [{ SESSION_SECRET: undefined }, /SESSION_SECRET is required/],
    [{ SESSION_SECRET: "" }, /SESSION_SECRET is required/],
    [{ SESSION_SECRET: "x".repeat(31) }, /SESSION_SECRET must be at least 32/],
    [{ ADMIN_PASSWORD: undefined }, /ADMIN_PASSWORD is required/],
    [{ ADMIN_PASSWORD: "short-pass" }, /ADMIN_PASSWORD must be at least 12/],
  ])("rejects %o", (override, message) => {
    const problems = productionEnvProblems({ ...GOOD, ...override });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(message);
  });

  it.each(KNOWN_INSECURE_SECRETS)("rejects the public value %j even though it may be long enough", (secret) => {
    expect(productionEnvProblems({ ...GOOD, SESSION_SECRET: secret })).toEqual([
      "SESSION_SECRET must not be a public example value",
    ]);
  });

  it("reports every problem at once", () => {
    expect(productionEnvProblems({ NODE_ENV: "production" })).toHaveLength(2);
  });
});
