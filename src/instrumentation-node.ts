import { productionEnvProblems } from "./lib/env-check";

/**
 * A misconfigured production deployment refuses to start with a clear message
 * instead of serving an unprotected admin panel. `next build` also sets
 * NODE_ENV=production, so the build phase is skipped.
 */
if (process.env.NEXT_PHASE !== "phase-production-build") {
  const problems = productionEnvProblems(process.env);
  if (problems.length > 0) {
    console.error(`\n[ai-support-assistant] Refusing to start.\n- ${problems.join("\n- ")}\n`);
    // Without an explicit exit, Next keeps listening and answers every request with a 500.
    process.exit(1);
  }
}
