import { beforeAll, describe, expect, it } from "vitest";
import type { Embedder } from "@/lib/rag/embeddings";
import { localEmbedder } from "@/lib/rag/embeddings";
import { retrieve } from "@/lib/rag/retrieval";
import { DEMO_ASSISTANT_ID } from "@/lib/seed";
import type { Chunk } from "@/lib/types";
import { seededStore } from "./helpers";

/**
 * A semantic model that never finds anything (query and documents are orthogonal), so every
 * confident result below must come from the typo-tolerant word matcher, and a semantic model
 * that matches everything, to check the word matcher never overrides a semantic hit.
 */
const blind: Embedder = {
  model: "fake-semantic",
  embedDocuments: async (texts) => texts.map(() => [0, 1]),
  embedQuery: async () => [1, 0],
  embedQueries: async (texts) => texts.map(() => [1, 0]),
};

let chunks: Chunk[];

beforeAll(async () => {
  const store = await seededStore();
  const local = await store.getChunks(DEMO_ASSISTANT_ID);
  // same knowledge base, but "embedded" by the fake semantic model
  chunks = local.map((c) => ({ ...c, embeddingModel: blind.model, embedding: [0, 1] }));
});

describe("hybrid search: word matching rescues what the semantic model misses", () => {
  it.each([
    ["cocuklara bakiyonuz mu", /Çocuklara/],
    ["dis beyazlatma ne kadr", /beyazlatma/],
    ["randvu nasıl alırm", /randevu/i],
    ["taksit yapıyomusunuz", /Ödeme/],
  ])("%j → %s via the word matcher", async (q, heading) => {
    const r = await retrieve(q, chunks, blind, { lang: "tr" });
    expect(r.confident).toBe(true);
    expect(r.via).toBe("lexical");
    expect(r.hits[0].chunk.heading).toMatch(heading);
  });

  it.each(["Dolar kuru bugün kaç TL?", "Göz muayenesi yapıyor musunuz?", "Bana bir kek tarifi verir misin?"])(
    "off-topic %j is still rejected by the word matcher's own thresholds",
    async (q) => {
      const r = await retrieve(q, chunks, blind, { lang: "tr" });
      expect(r.confident).toBe(false);
      expect(r.via).toBe("semantic");
    },
  );

  it("a confident semantic result is used as is (the word matcher is only a fallback)", async () => {
    const seeing: Embedder = { ...blind, embedQuery: async () => [0, 1] }; // matches every chunk perfectly
    const r = await retrieve("cocuklara bakiyonuz mu", chunks, seeing, { lang: "tr" });
    expect(r.confident).toBe(true);
    expect(r.via).toBe("semantic");
  });

  it("demo mode (local embedding) is unchanged", async () => {
    const store = await seededStore();
    const local = await store.getChunks(DEMO_ASSISTANT_ID);
    const r = await retrieve("cocuklara bakiyonuz mu", local, localEmbedder, { lang: "tr" });
    expect(r.confident).toBe(true);
    expect(r.via).toBe("lexical");
  });
});
