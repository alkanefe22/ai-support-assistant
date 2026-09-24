import { normalize, stems } from "./rag/text";
import type { Lang } from "./types";

/**
 * Conversational messages that are not questions: they must never trigger the
 * "I don't know + leave your contact details" hand-off. Recognised without any API call,
 * tolerant to slang ("slm", "mrb", "tşk") and small typos ("merhaa", "selm", "tesekurler").
 */
export type SmallTalkKind = "greeting" | "thanks" | "bye" | "ack" | "unclear";

// All words are in normalize() form (lower-case, Turkish letters folded).
const VOCAB: Record<Exclude<SmallTalkKind, "unclear">, string[]> = {
  greeting: [
    "merhaba", "merhabalar", "mrb", "mrhb", "mrba", "meraba", "slm", "slmlar", "selam", "selamlar", "sa",
    "selamunaleykum", "aleykumselam", "hey", "hi", "hello", "hola", "gunaydin", "tunaydin", "naber", "nbr",
    "nasilsin", "nasilsiniz", "napiyorsun", "morning", "afternoon", "evening", "howdy", "yo", "gunler",
    "aksamlar", "kolay", "gelsin", "nasilgidiyor", "iyimisin", "iyimisiniz",
  ],
  thanks: [
    "tesekkurler", "tesekkur", "tesekkurederim", "tsk", "tskler", "tsklr", "tsm", "sagol", "sagolun",
    "sagolasin", "eyv", "eyvallah", "thanks", "thank", "thx", "ty", "tyvm", "cheers", "mersi", "merci",
  ],
  bye: ["gorusuruz", "gorusmek", "uzere", "hoscakal", "hoscakalin", "bye", "bb", "goodbye", "geceler", "later"],
  ack: [
    "ok", "okay", "oki", "okey", "tamam", "tmm", "tm", "peki", "pki", "hmm", "hm", "evet", "hayir", "anladim",
    "anlasildi", "super", "harika", "guzel", "cool", "nice", "yes", "no", "yep", "nope", "sure", "alright",
    "k", "kk", "olur", "aynen",
  ],
};

/** Words that may accompany small talk without changing its meaning ("merhaba kanka", "çok teşekkürler"). */
const FILLERS = new Set([
  "kanka", "knk", "abi", "abla", "hocam", "hoca", "dostum", "bro", "ya", "iyi", "good", "cok", "much", "very",
  "so", "a", "lot", "you", "u", "siz", "size", "sana", "ederim", "ediyorum", "there", "all", "everyone",
  "herkese", "herkes", "dear", "sir", "the", "team", "ekip", "de", "da", "ve", "and", "see", "efendim",
]);

/** "slmmm" → "slm", "merhabaaa" → "merhaba" */
function squeeze(w: string): string {
  return w.replace(/(.)\1+/g, "$1");
}

/** Optimal-string-alignment distance (Levenshtein + adjacent transposition). */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const INDEX: { word: string; kind: Exclude<SmallTalkKind, "unclear"> }[] = Object.entries(VOCAB).flatMap(
  ([kind, words]) => words.map((w) => ({ word: squeeze(w), kind: kind as Exclude<SmallTalkKind, "unclear"> })),
);

function kindOf(token: string): Exclude<SmallTalkKind, "unclear"> | "filler" | null {
  const t = squeeze(token);
  if (FILLERS.has(token) || FILLERS.has(t)) return "filler";
  const exact = INDEX.find((e) => e.word === t || e.word === token);
  if (exact) return exact.kind;
  // Typo tolerance only for longer words, so short real words don't collide. Both the raw and the
  // squeezed form are tried: squeezing turns "merhaa" into "merha", which is further from "merhaba".
  if (token.length < 4) return null;
  const maxDist = token.length >= 8 ? 2 : 1;
  let best: { kind: Exclude<SmallTalkKind, "unclear">; dist: number } | null = null;
  for (const e of INDEX) {
    if (e.word.length < 4) continue;
    const dist = Math.min(editDistance(token, e.word), editDistance(t, e.word));
    if (dist <= maxDist && (!best || dist < best.dist)) best = { kind: e.kind, dist };
  }
  return best?.kind ?? null;
}

/**
 * Returns the kind of conversational message, or null for anything that should go
 * through knowledge-base search ("merhaba, implant fiyatı ne?" is a question → null).
 */
// Multi-word social phrases whose words would otherwise look like a question ("nasıl", "mi").
const PHRASES: [RegExp, string][] = [
  [/\bnasil gidiyo(r)?\b/g, "nasilgidiyor"],
  [/\bne haber\b/g, "naber"],
  [/\biyi misin(iz)?\b/g, "iyimisin"],
  [/\bhow are (you|u)\b/g, "howdy"],
  [/\bhow is it going\b/g, "howdy"],
  [/\bhave an? (nice|good|great|lovely) (day|one|evening|weekend)\b/g, "goodbye"],
  [/\biyi hafta ?sonlari\b/g, "gorusuruz"],
  [/\bkendin(e|ize) iyi bak(in)?\b/g, "gorusuruz"],
];

function socialPhrases(normalized: string): string {
  return PHRASES.reduce((s, [re, to]) => s.replace(re, to), normalized);
}

export function classifySmallTalk(message: string): SmallTalkKind | null {
  const tokens = socialPhrases(normalize(message))
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.length === 0) return "unclear"; // only punctuation / emoji
  if (tokens.length > 8) return null;

  // two-word phrases written apart: "hoşça kal", "sağ ol", "teşekkür ederim"
  if (tokens.length <= 3) {
    const joined = kindOf(tokens.join(""));
    if (joined && joined !== "filler") return joined;
  }

  const kinds = tokens.map(kindOf);
  if (kinds.every((k) => k !== null)) {
    const found = new Set(kinds.filter((k) => k !== "filler"));
    if (found.size === 0) return "ack"; // only fillers, e.g. "iyi", "çok iyi"
    for (const k of ["thanks", "bye", "greeting", "ack"] as const) if (found.has(k)) return k;
  }
  // "ne?", "nasıl?", "bu ne": nothing searchable left after stop-word removal
  if (stems(message).length === 0) return "unclear";
  // a single very short token that is not a known word ("x", "a1")
  if (tokens.length === 1 && tokens[0].length <= 2 && !/^\d+$/.test(tokens[0])) return "unclear";
  return null;
}

// Question words / particles and help requests (normalize() form). Checked per whole word.
const QUESTION_WORDS = new Set([
  // Turkish interrogatives and the question particle (written apart: "var mı", "yapıyor musunuz")
  "ne", "neden", "niye", "nicin", "nasil", "nerede", "nerde", "nereye", "nereden", "kac", "kaca", "hangi", "kim",
  "kime", "mi", "mu", "misin", "musun", "misiniz", "musunuz", "miyim", "muyum", "midir", "mudur", "miydi", "muydu",
  // needs and requests
  "istiyorum", "isterim", "lazim", "gerek", "gerekiyor", "yardim", "bilgi", "ogrenmek", "sorun", "problem",
  // English
  "what", "how", "where", "when", "why", "which", "who", "can", "could", "do", "does", "did", "is", "are", "will",
  "would", "should", "need", "want", "help", "have", "has", "problem", "issue",
]);

/**
 * Deterministic guard for the live-mode chat fallback: anything that looks like a question
 * or a request for help must get the normal hand-off (a human follows up), never a
 * conversational brush-off from a model that misread it as small talk.
 */
export function looksLikeQuestion(message: string): boolean {
  if (message.includes("?")) return true;
  return normalize(message)
    .split(/[^a-z0-9]+/)
    .some((t) => QUESTION_WORDS.has(t));
}

export function smallTalkReply(kind: SmallTalkKind, lang: Lang, businessName: string): string {
  const tr: Record<SmallTalkKind, string> = {
    greeting: `Merhaba! Size nasıl yardımcı olabilirim? ${businessName} hakkında merak ettiklerinizi sorabilirsiniz.`,
    thanks: "Rica ederim! Başka bir sorunuz olursa buradayım.",
    bye: "Görüşmek üzere, iyi günler dilerim! Sorunuz olursa buradayım.",
    ack: "Tamamdır! Başka bir konuda yardımcı olabileceğim bir şey var mı?",
    unclear: `Sizi tam anlayamadım. Sorunuzu biraz daha açık yazar mısınız? ${businessName} hakkında merak ettiklerinizi sorabilirsiniz.`,
  };
  const en: Record<SmallTalkKind, string> = {
    greeting: `Hello! How can I help you? Feel free to ask anything about ${businessName}.`,
    thanks: "You're welcome! I'm here if you have any other questions.",
    bye: "Goodbye, have a nice day! I'm here if you have any questions.",
    ack: "Got it! Is there anything else I can help you with?",
    unclear: `Sorry, I didn't quite get that. Could you write your question in a bit more detail? You can ask anything about ${businessName}.`,
  };
  return (lang === "en" ? en : tr)[kind];
}
