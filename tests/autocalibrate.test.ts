import { describe, expect, it, vi } from "vitest";
import { handleChat } from "@/lib/chat";
import type { GenerateInput, LlmProvider } from "@/lib/llm";
import { SEARCH_MARK } from "@/lib/prompt";
import {
  assistantThresholds,
  calibrateAssistant,
  OFF_TOPIC_PROBES,
  probeScores,
  thresholdFromProbes,
} from "@/lib/rag/autocalibrate";
import type { Embedder } from "@/lib/rag/embeddings";
import { localEmbedder } from "@/lib/rag/embeddings";
import { ingestDocument } from "@/lib/rag/ingest";
import { retrieve } from "@/lib/rag/retrieval";
import { DEMO_ASSISTANT, DEMO_ASSISTANT_ID } from "@/lib/seed";
import { seededStore, tempStore } from "./helpers";

/** Deterministic "semantic" embedder: a normalised bag of the first letters, enough to rank. */
function fakeSemantic(model = "fake-semantic"): Embedder {
  const vec = (t: string) => {
    const v = new Array(26).fill(0);
    for (const ch of t.toLowerCase()) {
      const i = ch.charCodeAt(0) - 97;
      if (i >= 0 && i < 26) v[i] += 1;
    }
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  };
  return {
    model,
    embedDocuments: async (t) => t.map(vec),
    embedQuery: async (t) => vec(t),
    embedQueries: vi.fn(async (t: string[]) => t.map(vec)),
  };
}

describe("threshold from off-topic probes", () => {
  it("sits just above the 90th percentile of what unrelated questions score", () => {
    const scores = [0.2, 0.25, 0.3, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.6]; // one outlier
    expect(thresholdFromProbes(scores)).toBe(0.39); // p90 = 0.36, + 0.03; the 0.6 outlier is ignored
  });

  it("is clamped to a sane range", () => {
    expect(thresholdFromProbes([0.01, 0.02])).toBe(0.3);
    expect(thresholdFromProbes([0.95, 0.99])).toBe(0.85);
  });

  it("probe score is the best cosine against the chunks", () => {
    const chunks = [{ embedding: [1, 0] }, { embedding: [0, 1] }] as never;
    expect(probeScores([[1, 0], [0.6, 0.8]], chunks)).toEqual([1, 0.8]);
  });

  it("has probes in both languages, none of them about a typical support topic", () => {
    expect(OFF_TOPIC_PROBES.tr.length).toBeGreaterThanOrEqual(20);
    expect(OFF_TOPIC_PROBES.en.length).toBe(OFF_TOPIC_PROBES.tr.length);
    for (const p of [...OFF_TOPIC_PROBES.tr, ...OFF_TOPIC_PROBES.en]) {
      expect(p).not.toMatch(/randevu|appointment|fiyat listesi|opening hours|iade|refund|kargo|shipping/i);
    }
  });
});

describe("calibrateAssistant", () => {
  it("stores per-language thresholds for a semantic model, computed once per language", async () => {
    const store = await seededStore();
    const emb = fakeSemantic();
    const docs = await store.listDocuments(DEMO_ASSISTANT_ID);
    for (const d of docs) await store.deleteDocument(DEMO_ASSISTANT_ID, d.id);
    await ingestDocument(store, { assistantId: DEMO_ASSISTANT_ID, title: "TR", lang: "tr", sourceType: "md", text: "## Kargo?\nKargo ücretsizdir." }, emb);
    const cal = (await store.getAssistant(DEMO_ASSISTANT_ID))!.retrieval!;
    expect(cal.model).toBe("fake-semantic");
    expect(cal.minScore.tr).toBeGreaterThanOrEqual(0.3);
    // no English chunks: English visitors are searched in the Turkish chunks, so that is calibrated too
    expect(cal.minScore.en).toBeGreaterThanOrEqual(0.3);
    expect(emb.embedQueries).toHaveBeenCalledTimes(2);
  });

  it("does nothing for the local word matcher (its thresholds are fixed and tested)", async () => {
    const store = await seededStore();
    expect(await calibrateAssistant(store, DEMO_ASSISTANT_ID, localEmbedder)).toBeNull();
    expect((await store.getAssistant(DEMO_ASSISTANT_ID))!.retrieval).toBeUndefined();
  });

  it("an ingest does not fail when calibration fails (provider down)", async () => {
    const store = await seededStore();
    const broken: Embedder = { ...fakeSemantic(), embedQueries: async () => { throw new Error("503"); } };
    const doc = await ingestDocument(store, { assistantId: DEMO_ASSISTANT_ID, title: "x", lang: "tr", sourceType: "md", text: "## A?\nB." }, broken);
    expect(doc.chunkCount).toBe(1);
  });

  it("returns null for an unknown assistant", async () => {
    expect(await calibrateAssistant(tempStore(), "nope", fakeSemantic())).toBeNull();
  });
});

describe("using the calibration", () => {
  it("only applies to the model it was computed for", () => {
    const a = { ...DEMO_ASSISTANT, retrieval: { model: "m1", weightCos: 1, minScore: { tr: 0.5 }, probeMax: {}, calibratedAt: "" } };
    expect(assistantThresholds(a, "m1", "tr")).toMatchObject({ minScore: 0.5, weightCos: 1, minCoverage: 0 });
    expect(assistantThresholds(a, "m2", "tr")).toBeUndefined();
    expect(assistantThresholds(a, "m1", "en")).toBeUndefined();
    expect(assistantThresholds(DEMO_ASSISTANT, "m1", "tr")).toBeUndefined();
  });

  it("retrieve() honours the assistant's threshold for semantic models", async () => {
    const emb = fakeSemantic();
    const store = tempStore();
    await store.saveAssistant({ ...DEMO_ASSISTANT });
    await ingestDocument(store, { assistantId: DEMO_ASSISTANT_ID, title: "t", lang: "tr", sourceType: "md", text: "## Kargo ücreti?\nKargo ücretsizdir." }, emb);
    const chunks = await store.getChunks(DEMO_ASSISTANT_ID);
    const low = await retrieve("kargo", chunks, emb, { lang: "tr", thresholds: { minScore: 0.1, minCoverage: 0, weightCos: 1 } });
    const high = await retrieve("kargo", chunks, emb, { lang: "tr", thresholds: { minScore: 0.99, minCoverage: 0, weightCos: 1 } });
    expect(low).toMatchObject({ confident: true, via: "semantic" });
    // above the assistant's threshold the semantic search gives up; the word matcher is still the
    // (separately gated) second chance, by design
    expect(high.via).toBe("lexical");
  });
});

describe("short follow-ups are resolved before answering", () => {
  it("the resolved meaning reaches the answer call on the FIRST attempt", async () => {
    const calls: GenerateInput[] = [];
    const llm: LlmProvider = {
      name: "ollama",
      generate: vi.fn(async (i: GenerateInput) => {
        calls.push(i);
        return i.system.includes(SEARCH_MARK) ? `${SEARCH_MARK} implant tedavisi süresi` : "3-6 ay sürer. [[SOURCE:1]]";
      }),
    };
    const store = await seededStore();
    const first = await handleChat({ assistantId: DEMO_ASSISTANT_ID, message: "İmplant fiyatı nedir?", lang: "tr" }, { store, llm, embedder: localEmbedder });
    calls.length = 0;
    const res = await handleChat(
      { assistantId: DEMO_ASSISTANT_ID, message: "Süresi ne kadar?", lang: "tr", conversationId: first.conversationId },
      { store, llm, embedder: localEmbedder },
    );
    expect(calls[0].system).toContain(SEARCH_MARK); // triage first
    expect(calls[1].user).toContain("<question_meaning>\nimplant tedavisi süresi");
    expect(res.answered).toBe(true);
    expect(res.sources[0].heading).toMatch(/İmplant/);
  });

  it("long or first messages are not pre-resolved (no extra call)", async () => {
    const llm: LlmProvider = { name: "ollama", generate: vi.fn(async () => "6.500 TL. [[SOURCE:1]]") };
    const store = await seededStore();
    await handleChat({ assistantId: DEMO_ASSISTANT_ID, message: "Diş beyazlatma ne kadar?", lang: "tr" }, { store, llm, embedder: localEmbedder });
    expect(llm.generate).toHaveBeenCalledTimes(1);
  });
});
