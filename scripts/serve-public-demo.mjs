/**
 * Starts the production build as a public, read-only portfolio demo (PUBLIC_DEMO=true: anyone can
 * browse the admin panel read-only, and try the assistant with their own site at /try).
 *
 *   npm run build && npm run start:public-demo              # free: AI_PROVIDER=demo, no API calls
 *   npm run build && npm run start:public-demo -- --live    # real AI from .env.local (Gemini / Claude / Ollama)
 *   PORT=3100 npm run start:public-demo
 *
 * Without --live the provider is forced to demo mode (overrides .env.local, which Next never overrides).
 * With --live the limits from .env.local apply (RATE_LIMIT_PER_MINUTE, DAILY_REQUEST_LIMIT, TRY_DAILY_LIMIT).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const live = process.argv.includes("--live");

const env = { ...process.env, PUBLIC_DEMO: "true" };
if (!live) {
  Object.assign(env, {
    AI_PROVIDER: "demo",
    EMBEDDING_PROVIDER: "local",
    // demo mode costs nothing, so the (live-mode) daily cap from .env.local would only get in the way
    DAILY_REQUEST_LIMIT: process.env.DAILY_REQUEST_LIMIT ?? "1000",
    // visitors click through several suggested questions in a row on /try
    RATE_LIMIT_PER_MINUTE: process.env.RATE_LIMIT_PER_MINUTE ?? "20",
  });
}
console.log(`[public-demo] ${live ? "LIVE: real AI from .env.local, its limits apply" : "demo mode: no AI calls, no cost"}`);

const child = spawn(process.execPath, [nextBin, "start", "-p", process.env.PORT ?? "3000"], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
