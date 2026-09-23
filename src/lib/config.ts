import path from "node:path";

export type ProviderName = "demo" | "gemini" | "claude";
export type EmbeddingProviderName = "local" | "gemini";

function int(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Resolves the active LLM provider. A provider is only used when its key
 * exists; otherwise we fall back to demo mode so nothing can incur cost.
 */
export function resolveProvider(): ProviderName {
  const wanted = (process.env.AI_PROVIDER ?? "demo").toLowerCase();
  if (wanted === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (wanted === "claude" && process.env.ANTHROPIC_API_KEY) return "claude";
  return "demo";
}

export function resolveEmbeddingProvider(): EmbeddingProviderName {
  const wanted = (process.env.EMBEDDING_PROVIDER ?? "local").toLowerCase();
  if (wanted === "gemini" && process.env.GEMINI_API_KEY && resolveProvider() !== "demo") {
    return "gemini";
  }
  return "local";
}

export function getConfig() {
  return {
    provider: resolveProvider(),
    embeddingProvider: resolveEmbeddingProvider(),
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    claudeModel: process.env.CLAUDE_MODEL || "claude-haiku-4-5",
    rateLimitPerMinute: int("RATE_LIMIT_PER_MINUTE", 8),
    dailyRequestLimit: int("DAILY_REQUEST_LIMIT", 300),
    maxQuestionChars: int("MAX_QUESTION_CHARS", 500),
    maxContextTokens: int("MAX_CONTEXT_TOKENS", 1500),
    maxOutputTokens: int("MAX_OUTPUT_TOKENS", 350),
    sessionSecret: process.env.SESSION_SECRET || "dev-only-insecure-secret",
    adminPassword: process.env.ADMIN_PASSWORD || "",
  };
}

export function dataDir(): string {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  // Vercel's filesystem is read-only except /tmp.
  if (process.env.VERCEL) return "/tmp/ai-support-assistant";
  return path.resolve("data");
}
