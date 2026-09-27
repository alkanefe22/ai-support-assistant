/**
 * Runs once when the server starts. Node-only work lives in a separate module so
 * an Edge bundle (e.g. a future middleware) never sees `process.exit`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
