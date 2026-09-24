import { getConfig, type ProviderName } from "../config";
import { claudeGenerate } from "./claude";
import { geminiGenerate } from "./gemini";
import { ollamaGenerate } from "./ollama";

export interface GenerateInput {
  system: string;
  user: string;
  maxOutputTokens: number;
}

export interface LlmProvider {
  name: ProviderName;
  generate(input: GenerateInput): Promise<string>;
}

/**
 * Returns the configured remote LLM, or null in demo mode
 * (the demo responder in ./demo.ts answers without any API call).
 */
export function getLlm(): LlmProvider | null {
  const cfg = getConfig();
  if (cfg.provider === "gemini") {
    return { name: "gemini", generate: (i) => geminiGenerate(i, cfg.geminiModel) };
  }
  if (cfg.provider === "claude") {
    return { name: "claude", generate: (i) => claudeGenerate(i, cfg.claudeModel) };
  }
  if (cfg.provider === "ollama") {
    return { name: "ollama", generate: (i) => ollamaGenerate(i, cfg.ollamaModel) };
  }
  return null;
}
