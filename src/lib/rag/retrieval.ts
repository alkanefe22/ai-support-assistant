import type { Chunk, Lang } from "../types";
import { cosine, localEmbed, LOCAL_EMBEDDING_MODEL, type Embedder } from "./embeddings";
import { stem, stemMatch, stems, synonymsOf, tokenize } from "./text";

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
  /** which search produced the hits: semantic embedding, or the typo-tolerant word matcher */
  via?: "semantic" | "lexical";
}

export type Thresholds = { minScore: number; minCoverage: number; weightCos: number };

/**
 * Thresholds are per embedding model because cosine scales differ.
 * - local: tuned against tests/retrieval.test.ts.
 * - gemini-embedding-2: calibrated with `npm run calibrate` on the demo KB (24.09.2026).
 *   Semantic matches ("bad breath" → "halitosis") have zero word overlap, so coverage is not
 *   required. Dental questions the KB does not cover ("veneers") still score high here;
 *   the model's [[NO_ANSWER]] rule is the second gate for those.
 */
const THRESHOLDS: Record<string, Thresholds> = {
  [LOCAL_EMBEDDING_MODEL]: { minScore: 0.3, minCoverage: 0.4, weightCos: 0.5 },
  "gemini-embedding-2": { minScore: 0.618, minCoverage: 0, weightCos: 0.95 },
};

function num(name: string): number | undefined {
  const v = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(v) ? v : undefined;
}

export function thresholdsFor(model: string): Thresholds {
  if (model === LOCAL_EMBEDDING_MODEL) return THRESHOLDS[model];
  // Semantic models: built-in values, overridable from the env with what `npm run calibrate` prints.
  // Uncalibrated models (e.g. any Ollama model) start from the Gemini values; calibrate before trusting them.
  const base = THRESHOLDS[model] ?? THRESHOLDS["gemini-embedding-2"];
  return {
    minScore: num("RETRIEVAL_MIN_SCORE") ?? base.minScore,
    minCoverage: num("RETRIEVAL_MIN_COVERAGE") ?? base.minCoverage,
    weightCos: num("RETRIEVAL_WEIGHT_COS") ?? base.weightCos,
  };
}

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
// Turkish verb endings (folded): verbs are phrased differently in questions and answers
// ("bakıyor musunuz" vs "hizmet veriyoruz"), so an unmatched verb says nothing about the topic.
const VERBISH = /(iyor|uyor|yor|iyo|uyo|abil|ebil|mek|mak|mis|mus|irse|ursa|erse|arsa|ecek|acak|dim|dum|tim|tum|mem|mam|iniz|unuz|onuz|isiniz|usunuz|lim|lum|ir|ur)$/;

function coverages(queryStems: string[], chunkStems: Set<string>[], queryTokens: string[] = []): { scores: number[]; unknown: string[] } {
  const n = chunkStems.length;
  const terms = [...new Set(queryStems)];
  const scores = new Array<number>(n).fill(0);
  /** content words (5+ letters) that occur nowhere in the knowledge base */
  const unknown: string[] = [];
  if (terms.length === 0) return { scores, unknown };
  let total = 0;
  for (const q of terms) {
    const alts = [q, ...synonymsOf(q)];
    const matches = chunkStems.map((set) => containsTerm(set, alts));
    const df = matches.filter(Boolean).length;
    if (df === 0 && q.length >= 5) {
      // only report it when every word with this stem looks like a noun, not a verb form
      const words = queryTokens.filter((t) => stem(t) === q);
      if (words.length === 0 || words.some((w) => !VERBISH.test(w))) unknown.push(q);
    }
    const idf = Math.log(1 + n / (1 + df));
    total += idf;
    matches.forEach((m, i) => {
      if (m) scores[i] += idf;
    });
  }
  return { scores: scores.map((s) => s / total), unknown };
}

export async function retrieve(
  query: string,
  chunks: Chunk[],
  embedder: Embedder,
  /**
   * strictSubject: demo mode only (no model to double-check), see below.
   * thresholds: the assistant's own calibration (rag/autocalibrate.ts), used for semantic models.
   */
  opts: { lang?: Lang; topK?: number; strictSubject?: boolean; thresholds?: Thresholds } = {},
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
  const t = model !== LOCAL_EMBEDDING_MODEL && opts.thresholds ? opts.thresholds : thresholdsFor(model);

  const chunkStems = pool.map((c) => new Set(stems(indexTextFor(c))));
  const { scores: covs, unknown } = coverages(stems(query), chunkStems, tokenize(query));

  const scored = pool.map((chunk, i) => {
    const vec = model === chunk.embeddingModel ? chunk.embedding : localVector(chunk);
    const cos = Math.max(0, cosine(qVec, vec));
    const cov = covs[i];
    return { chunk, cosine: cos, coverage: cov, score: t.weightCos * cos + (1 - t.weightCos) * cov };
  });
  const primary = ranked(scored, topK, t);
  if (model === LOCAL_EMBEDDING_MODEL) {
    // Word matching alone with no model to double-check (demo mode): if the question's own subject
    // never occurs in the knowledge base ("anestezi", "dentures"), the remaining generic words
    // ("tedavi", "how much") would pick an unrelated section. Hand off instead.
    const confident = primary.confident && !(opts.strictSubject && unknown.length > 0);
    return { ...primary, confident, via: "lexical" };
  }
  if (primary.confident) return { ...primary, via: "semantic" };

  // Second chance for semantic models: the typo-tolerant word matcher (the tuned demo-mode
  // search). A semantic model can miss "cocuklara bakiyonuz mu" while stems + trigrams still
  // match "Çocuklara hizmet veriyor musunuz?". Its own thresholds still reject off-topic text,
  // and the model must cite a chunk afterwards, so this cannot turn a guess into an answer.
  const lt = THRESHOLDS[LOCAL_EMBEDDING_MODEL];
  const lq = localEmbed(query);
  const lexical = pool.map((chunk, i) => {
    const cos = Math.max(0, cosine(lq, localVector(chunk)));
    return { chunk, cosine: cos, coverage: covs[i], score: lt.weightCos * cos + (1 - lt.weightCos) * covs[i] };
  });
  const second = ranked(lexical, topK, lt);
  return second.confident ? { ...second, via: "lexical" } : { ...primary, via: "semantic" };
}

function ranked(scored: ScoredChunk[], topK: number, t: Thresholds) {
  const hits = [...scored].sort((a, b) => b.score - a.score).slice(0, topK);
  const best = hits[0];
  const confident = !!best && best.score >= t.minScore && best.coverage >= t.minCoverage;
  return { hits, confident, topScore: best?.score ?? 0 };
}

// Local vectors are cheap but not free; cache them per chunk (keyed by id + text so edits invalidate).
const localCache = new Map<string, number[]>();
function localVector(chunk: Chunk): number[] {
  if (chunk.embeddingModel === LOCAL_EMBEDDING_MODEL) return chunk.embedding;
  const key = `${chunk.id}:${chunk.heading.length}:${chunk.text.length}`;
  let v = localCache.get(key);
  if (!v) {
    v = localEmbed(indexTextFor(chunk));
    if (localCache.size > 20_000) localCache.clear();
    localCache.set(key, v);
  }
  return v;
}
