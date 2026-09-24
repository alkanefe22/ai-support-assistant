import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleChat } from "@/lib/chat";
import { getConfig, resolveEmbeddingProvider, resolveProvider } from "@/lib/config";
import { getLlm } from "@/lib/llm";
import { ollamaGenerate } from "@/lib/llm/ollama";
import { getEmbedder, localEmbedder, LOCAL_EMBEDDING_MODEL } from "@/lib/rag/embeddings";
import { thresholdsFor } from "@/lib/rag/retrieval";
import { DEMO_ASSISTANT_ID } from "@/lib/seed";
import { seededStore } from "./helpers";

const KEYS = [
  "AI_PROVIDER", "EMBEDDING_PROVIDER", "OLLAMA_URL", "OLLAMA_MODEL", "OLLAMA_EMBEDDING_MODEL",
  "RETRIEVAL_MIN_SCORE", "RETRIEVAL_WEIGHT_COS", "RETRIEVAL_MIN_COVERAGE", "GEMINI_API_KEY", "OLLAMA_THINK",
] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[];

function mockFetch(handler: (url: string, body: Record<string, unknown>) => unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      return new Response(JSON.stringify(handler(url, body)), { status });
    }),
  );
}

beforeEach(() => {
  calls = [];
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("provider selection", () => {
  it("ollama needs no API key (it runs on this machine)", () => {
    process.env.AI_PROVIDER = "ollama";
    expect(resolveProvider()).toBe("ollama");
    expect(getLlm()?.name).toBe("ollama");
    expect(getConfig()).toMatchObject({ ollamaUrl: "http://localhost:11434", ollamaModel: "gemma3:12b" });
  });

  it("ollama embeddings can be combined with any chat provider, even demo", () => {
    process.env.EMBEDDING_PROVIDER = "ollama";
    expect(resolveEmbeddingProvider()).toBe("ollama");
    expect(getEmbedder().model).toBe("ollama:bge-m3");
    process.env.OLLAMA_EMBEDDING_MODEL = "nomic-embed-text";
    expect(getEmbedder().model).toBe("ollama:nomic-embed-text");
  });

  it("paid providers still fall back to demo without a key", () => {
    process.env.AI_PROVIDER = "gemini";
    expect(resolveProvider()).toBe("demo");
  });
});

describe("ollama chat", () => {
  it("sends system + user messages, no streaming, output cap as num_predict", async () => {
    process.env.OLLAMA_URL = "http://127.0.0.1:11434/";
    mockFetch(() => ({ message: { role: "assistant", content: "Beyazlatma 6.500 TL'dir." } }));
    const out = await ollamaGenerate({ system: "SYS", user: "USER", maxOutputTokens: 300 }, "qwen3:14b");
    expect(out).toBe("Beyazlatma 6.500 TL'dir.");
    expect(calls[0].url).toBe("http://127.0.0.1:11434/api/chat"); // trailing slash trimmed
    expect(calls[0].body).toMatchObject({
      model: "qwen3:14b",
      stream: false,
      messages: [
        { role: "system", content: "SYS" },
        { role: "user", content: "USER" },
      ],
      options: { temperature: 0.1, num_predict: 300 },
    });
  });

  it("sends think:false only when OLLAMA_THINK is set (reasoning models)", async () => {
    mockFetch(() => ({ message: { content: "ok" } }));
    await ollamaGenerate({ system: "", user: "", maxOutputTokens: 50 }, "m");
    expect(calls[0].body).not.toHaveProperty("think");
    process.env.OLLAMA_THINK = "false";
    await ollamaGenerate({ system: "", user: "", maxOutputTokens: 50 }, "qwen3.5:9b");
    expect(calls[1].body).toMatchObject({ think: false });
  });

  it("never shows a reasoning model's <think> block to the visitor", async () => {
    mockFetch(() => ({ message: { content: "<think>fiyat tablosuna bakayım…</think>\nBeyazlatma 6.500 TL'dir." } }));
    expect(await ollamaGenerate({ system: "", user: "", maxOutputTokens: 50 }, "m")).toBe("Beyazlatma 6.500 TL'dir.");
  });

  it("throws on HTTP errors (the chat flow turns that into 'try again later')", async () => {
    mockFetch(() => ({ error: "model not found" }), 404);
    await expect(ollamaGenerate({ system: "", user: "", maxOutputTokens: 50 }, "m")).rejects.toThrow("404");
  });
});

describe("ollama embeddings", () => {
  it("embeds a batch in one call and normalizes the vectors", async () => {
    process.env.EMBEDDING_PROVIDER = "ollama";
    mockFetch((_url, body) => ({ embeddings: (body.input as string[]).map((_, i) => [3, 4 + i]) }));
    const vecs = await getEmbedder().embedQueries(["a", "b"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:11434/api/embed");
    expect(calls[0].body).toEqual({ model: "bge-m3", input: ["a", "b"] });
    expect(vecs[0][0]).toBeCloseTo(0.6);
    expect(vecs[0][1]).toBeCloseTo(0.8);
    for (const v of vecs) expect(Math.hypot(...v)).toBeCloseTo(1);
  });
});

describe("retrieval thresholds for uncalibrated models", () => {
  it("start from the calibrated Gemini values and take the calibration output from the env", () => {
    expect(thresholdsFor("ollama:bge-m3")).toEqual({ minScore: 0.618, minCoverage: 0, weightCos: 0.95 });
    process.env.RETRIEVAL_MIN_SCORE = "0.55";
    process.env.RETRIEVAL_WEIGHT_COS = "0.9";
    expect(thresholdsFor("ollama:bge-m3")).toEqual({ minScore: 0.55, minCoverage: 0, weightCos: 0.9 });
  });

  it("the tuned local (demo) thresholds are never overridden", () => {
    process.env.RETRIEVAL_MIN_SCORE = "0.99";
    expect(thresholdsFor(LOCAL_EMBEDDING_MODEL).minScore).toBe(0.3);
  });
});

describe("end to end with AI_PROVIDER=ollama (fetch mocked)", () => {
  it("answers from the knowledge base through the local model", async () => {
    process.env.AI_PROVIDER = "ollama";
    mockFetch(() => ({ message: { content: "Ofis tipi diş beyazlatma 6.500 TL'dir. [[SOURCE:1]]" } }));
    const store = await seededStore();
    const res = await handleChat(
      { assistantId: DEMO_ASSISTANT_ID, message: "Diş beyazlatma ne kadar?", lang: "tr" },
      { store, embedder: localEmbedder }, // llm comes from the env: ollama
    );
    expect(res.provider).toBe("ollama");
    expect(res.answered).toBe(true);
    expect(res.answer).toBe("Ofis tipi diş beyazlatma 6.500 TL'dir.");
    expect(res.sources[0].heading).toMatch(/beyazlatma/);
    expect(String((calls[0].body.messages as { content: string }[])[1].content)).toContain("<kb_document");
  });
});
