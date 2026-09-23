import { resolveEmbeddingProvider } from "../config";
import { stems } from "./text";

export const LOCAL_EMBEDDING_MODEL = "local-hash-v1";
export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const LOCAL_DIM = 1024;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function l2normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? v : v.map((x) => x / n);
}

/**
 * Free, offline "embedding": a hashed bag of stems plus character trigrams
 * (trigrams make it tolerant to typos and Turkish suffixes). Not semantic, but
 * deterministic and good enough for FAQ-style knowledge bases and for tests.
 */
export function localEmbed(text: string): number[] {
  const v = new Array<number>(LOCAL_DIM).fill(0);
  for (const s of stems(text)) {
    const h = fnv1a(`w:${s}`);
    v[h % LOCAL_DIM] += h & 0x100 ? 1 : -1;
    const padded = `^${s}$`;
    for (let i = 0; i + 3 <= padded.length; i++) {
      const t = fnv1a(`t:${padded.slice(i, i + 3)}`);
      v[t % LOCAL_DIM] += (t & 0x100 ? 1 : -1) * 0.35;
    }
  }
  return l2normalize(v);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function geminiEmbed(texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY") {
  const key = process.env.GEMINI_API_KEY!;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents`;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model: `models/${GEMINI_EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality: 768,
        })),
      }),
    });
    if (!res.ok) throw new Error(`Gemini embedding failed: ${res.status}`);
    const json = (await res.json()) as { embeddings: { values: number[] }[] };
    out.push(...json.embeddings.map((e) => l2normalize(e.values)));
  }
  return out;
}

export interface Embedder {
  model: string;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export const localEmbedder: Embedder = {
  model: LOCAL_EMBEDDING_MODEL,
  embedDocuments: async (texts) => texts.map(localEmbed),
  embedQuery: async (text) => localEmbed(text),
};

export function getEmbedder(): Embedder {
  if (resolveEmbeddingProvider() === "gemini") {
    return {
      model: GEMINI_EMBEDDING_MODEL,
      embedDocuments: (texts) => geminiEmbed(texts, "RETRIEVAL_DOCUMENT"),
      embedQuery: async (text) => (await geminiEmbed([text], "RETRIEVAL_QUERY"))[0],
    };
  }
  return localEmbedder;
}
