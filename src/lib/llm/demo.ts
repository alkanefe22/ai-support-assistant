import type { ScoredChunk } from "../rag/retrieval";
import { queryStems, splitSentences, stemMatch, stems, synonymsOf } from "../rag/text";
import { looksLikeInjection } from "../prompt";

/**
 * Demo responder: no API call, no cost. Retrieval is real; generation is replaced by an
 * extractive answer (the most relevant sentences of the best-matching chunk).
 * Small talk is handled before retrieval, see ../smalltalk.ts.
 */
export function demoAnswer(question: string, hits: ScoredChunk[]): string {
  const top = hits[0];
  if (!top) return "";
  // same matching as retrieval: suffix variation and synonyms ("saatleriniz" ~ "açığız")
  const terms = [...new Set(queryStems(question))].map((q) => [q, ...synonymsOf(q)]);
  const sentences = top.chunk.text
    .split("\n")
    .flatMap((line) => splitSentences(line.replace(/^[-*•]\s+/, "")))
    // never repeat instruction-like text from the knowledge base
    .filter((s) => !looksLikeInjection(s));
  // Short FAQ answers are returned whole: "No, we only …" must keep its "No".
  if (sentences.length <= 3) return sentences.join(" ");
  // A short list (a price list) is returned whole, one item per line: dropping an item would be wrong.
  const lines = top.chunk.text.split("\n").map((l) => l.trim()).filter(Boolean);
  const items = lines.filter((l) => /^[-*•]\s+/.test(l));
  if (items.length >= 2 && items.length >= lines.length - 1 && items.length <= 12) {
    return lines.filter((l) => !looksLikeInjection(l)).map((l) => l.replace(/^[-*•]\s+/, "• ")).join("\n");
  }

  const scored = sentences.map((s, i) => {
    const own = stems(s);
    return { s, i, score: terms.filter((alts) => own.some((t) => alts.some((a) => stemMatch(a, t)))).length };
  });
  const relevant = scored.filter((x) => x.score > 0);
  // nothing specific matched (a broad "what are your prices?" over a price list): show the whole short list
  if (relevant.length === 0 && sentences.length <= 6) return sentences.join(" ");
  const picked = (relevant.length > 0 ? relevant : scored)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 3)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
  return picked.join(" ");
}
