/**
 * Starts the production build as a public, read-only portfolio demo:
 *   - PUBLIC_DEMO=true  → anyone can browse the admin panel read-only
 *   - AI_PROVIDER=demo  → no API calls, no cost (overrides .env.local, which Next never overrides)
 *
 *   npm run build && npm run start:public-demo            # http://localhost:3000
 *   PORT=3100 npm run start:public-demo
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, "start", "-p", process.env.PORT ?? "3000"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PUBLIC_DEMO: "true",
    AI_PROVIDER: "demo",
    EMBEDDING_PROVIDER: "local",
    // demo mode costs nothing, so the (live-mode) daily cap from .env.local would only get in the way
    DAILY_REQUEST_LIMIT: process.env.DAILY_REQUEST_LIMIT ?? "1000",
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
