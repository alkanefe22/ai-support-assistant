import { getConfig } from "../config";
import type { GenerateInput } from "./index";

/**
 * Local model through Ollama's native chat API (http://localhost:11434/api/chat).
 * No key and no cost; used for unlimited end-to-end tests on this machine.
 */
export async function ollamaGenerate(input: GenerateInput, model: string): Promise<string> {
  const cfg = getConfig();
  const res = await fetch(`${cfg.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      options: { temperature: 0.1, num_predict: input.maxOutputTokens },
      ...(cfg.ollamaThink === undefined ? {} : { think: cfg.ollamaThink }),
    }),
    signal: AbortSignal.timeout(cfg.ollamaTimeoutMs),
  });
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
  const json = (await res.json()) as { message?: { content?: string } };
  // Reasoning models may still inline <think>…</think>; the visitor must never see it.
  return (json.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
