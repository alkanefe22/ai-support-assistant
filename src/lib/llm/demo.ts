import type { ScoredChunk } from "../rag/retrieval";
import { splitSentences, stems } from "../rag/text";
import { looksLikeInjection } from "../prompt";

/**
 * Demo responder: no API call, no cost. Retrieval is real; generation is replaced by an
 * extractive answer (the most relevant sentences of the best-matching chunk).
 * Small talk is handled before retrieval, see ../smalltalk.ts.
 */
export function demoAnswer(question: string, hits: ScoredChunk[]): string {
  const top = hits[0];
  if (!top) return "";
  const q = new Set(stems(question));
  const sentences = top.chunk.text
    .split("\n")
    .flatMap((line) => splitSentences(line.replace(/^[-*•]\s+/, "")))
    // never repeat instruction-like text from the knowledge base
    .filter((s) => !looksLikeInjection(s));
  // Short FAQ answers are returned whole: "No, we only …" must keep its "No".
  if (sentences.length <= 3) return sentences.join(" ");

  const scored = sentences.map((s, i) => ({
    s,
    i,
    score: stems(s).filter((t) => q.has(t)).length,
  }));
  const relevant = scored.filter((x) => x.score > 0);
  const picked = (relevant.length > 0 ? relevant : scored)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 3)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
  return picked.join(" ");
}
