import type { Lang } from "../types";
import type { ScoredChunk } from "../rag/retrieval";
import { normalize, splitSentences, stems } from "../rag/text";
import { looksLikeInjection } from "../prompt";

/**
 * Demo responder: no API call, no cost. Retrieval is real; generation is replaced by
 * pre-recorded replies for small talk and an extractive answer (the most relevant
 * sentences of the best-matching chunk) for everything else.
 */
const RECORDED: { pattern: RegExp; reply: Record<Lang, string> }[] = [
  {
    pattern: /^(merhaba|selam|iyi gunler|gunaydin|hello|hi|hey|good (morning|afternoon|evening))\b[\s!.,]*$/,
    reply: {
      tr: "Merhaba! Size nasıl yardımcı olabilirim? Hizmetlerimiz, fiyatlar, randevu veya çalışma saatleri hakkında sorabilirsiniz.",
      en: "Hello! How can I help you? You can ask about our services, prices, appointments or opening hours.",
    },
  },
  {
    pattern: /^(tesekkur(ler| ederim)?|sagol|sag ol|thanks|thank you|thx)\b[\s!.,]*$/,
    reply: {
      tr: "Rica ederim! Başka bir sorunuz olursa buradayım.",
      en: "You're welcome! I'm here if you have any other questions.",
    },
  },
];

export function recordedReply(question: string, lang: Lang): string | null {
  const q = normalize(question).trim();
  const hit = RECORDED.find((r) => r.pattern.test(q));
  return hit ? hit.reply[lang] : null;
}

export function demoAnswer(question: string, hits: ScoredChunk[]): string {
  const top = hits[0];
  if (!top) return "";
  const q = new Set(stems(question));
  const sentences = top.chunk.text
    .split("\n")
    .flatMap((line) => splitSentences(line.replace(/^[-*•]\s+/, "")))
    // never repeat instruction-like text from the knowledge base
    .filter((s) => !looksLikeInjection(s));

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
