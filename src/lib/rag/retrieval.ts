import type { Chunk, Lang } from "../types";
import { cosine, localEmbed, LOCAL_EMBEDDING_MODEL, type Embedder } from "./embeddings";
import { stemMatch, stems, synonymsOf } from "./text";

export interface ScoredChunk {
  chunk: Chunk;
  score: number;
  cosine: number;
  coverage: number;
}

export interface RetrievalResult {
  hits: ScoredChunk[];
  /** true when the best hit clears the confidence threshold */
  confident: boolean;
  topScore: number;
}

/**
 * Thresholds are per embedding model because cosine scales differ.
 * Local values were tuned against tests/retrieval.test.ts.
 */
const THRESHOLDS: Record<string, { minScore: number; minCoverage: number; weightCos: number }> = {
  [LOCAL_EMBEDDING_MODEL]: { minScore: 0.3, minCoverage: 0.4, weightCos: 0.5 },
  "gemini-embedding-001": { minScore: 0.55, minCoverage: 0.15, weightCos: 0.75 },
};

export function indexTextFor(c: Pick<Chunk, "heading" | "text">): string {
  // The heading is repeated: for FAQ sources it *is* the question, the strongest signal.
  return `${c.heading}\n${c.heading}\n${c.text}`;
}

function containsTerm(chunkStems: Set<string>, alternatives: string[]): boolean {
  for (const s of chunkStems) if (alternatives.some((a) => stemMatch(a, s))) return true;
  return false;
}

/**
 * IDF-weighted share of the query's terms that occur in each chunk (fuzzy stem match
 * plus synonyms). Query terms that appear nowhere in the knowledge base get the highest
 * weight, so off-topic questions ("do you do eye exams?") score low even if they share
 * one word with the knowledge base.
 */
function coverages(queryStems: string[], chunkStems: Set<string>[]): number[] {
  const n = chunkStems.length;
  const terms = [...new Set(queryStems)];
  const scores = new Array<number>(n).fill(0);
  if (terms.length === 0) return scores;
  let total = 0;
  for (const q of terms) {
    const alts = [q, ...synonymsOf(q)];
    const matches = chunkStems.map((set) => containsTerm(set, alts));
    const df = matches.filter(Boolean).length;
    const idf = Math.log(1 + n / (1 + df));
    total += idf;
    matches.forEach((m, i) => {
      if (m) scores[i] += idf;
    });
  }
  return scores.map((s) => s / total);
}

export async function retrieve(
  query: string,
  chunks: Chunk[],
  embedder: Embedder,
  opts: { lang?: Lang; topK?: number } = {},
): Promise<RetrievalResult> {
  const topK = opts.topK ?? 4;
  if (chunks.length === 0 || !query.trim()) return { hits: [], confident: false, topScore: 0 };

  // Prefer chunks in the visitor's language, but fall back to everything.
  const sameLang = opts.lang ? chunks.filter((c) => c.lang === opts.lang) : chunks;
  const pool = sameLang.length > 0 ? sameLang : chunks;

  // Chunks embedded with another model (provider switched without re-index) are scored locally.
  const model = pool.every((c) => c.embeddingModel === embedder.model)
    ? embedder.model
    : LOCAL_EMBEDDING_MODEL;
  const qVec = model === embedder.model ? await embedder.embedQuery(query) : localEmbed(query);
  const t = THRESHOLDS[model] ?? THRESHOLDS[LOCAL_EMBEDDING_MODEL];

  const chunkStems = pool.map((c) => new Set(stems(indexTextFor(c))));
  const covs = coverages(stems(query), chunkStems);

  const scored = pool.map((chunk, i) => {
    const vec = model === chunk.embeddingModel ? chunk.embedding : localEmbed(indexTextFor(chunk));
    const cos = Math.max(0, cosine(qVec, vec));
    const cov = covs[i];
    return { chunk, cosine: cos, coverage: cov, score: t.weightCos * cos + (1 - t.weightCos) * cov };
  });
  scored.sort((a, b) => b.score - a.score);
  const hits = scored.slice(0, topK);
  const best = hits[0];
  const confident = !!best && best.score >= t.minScore && best.coverage >= t.minCoverage;
  return { hits, confident, topScore: best?.score ?? 0 };
}
