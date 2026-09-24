import { randomUUID } from "node:crypto";
import { getConfig } from "./config";
import { getLlm, type LlmProvider } from "./llm";
import { demoAnswer } from "./llm/demo";
import {
  buildPrompt,
  buildTriagePrompt,
  looksLikeDecline,
  looksLikeInjection,
  NO_ANSWER,
  parseAnswer,
  parseTriage,
  type Triage,
} from "./prompt";
import { getEmbedder, type Embedder } from "./rag/embeddings";
import { retrieve, type ScoredChunk } from "./rag/retrieval";
import { detectLang, normalize } from "./rag/text";
import { classifySmallTalk, looksLikeQuestion, smallTalkReply } from "./smalltalk";
import type { Store } from "./store";
import { displayNames, type ChatResult, type Conversation, type Lang, type SourceRef, type UnansweredQuestion } from "./types";

export const HANDOFF_MESSAGE: Record<Lang, string> = {
  tr: "Bu konuda bilgim yok, sizi yetkiliye yönlendireyim. İletişim bilgilerinizi bırakırsanız ekibimiz en kısa sürede size dönüş yapar.",
  en: "I don't have information on that, let me connect you with our team. If you leave your contact details, someone will get back to you shortly.",
};

/** Provider failed (timeout, 503, quota): the answer may well exist, so don't claim "I don't know". */
export const UNAVAILABLE_MESSAGE: Record<Lang, string> = {
  tr: "Şu anda yanıt veremiyorum, lütfen biraz sonra tekrar deneyin. İsterseniz iletişim bilgilerinizi bırakın, ekibimiz size dönüş yapsın.",
  en: "I can't answer right now, please try again in a moment. If you like, leave your contact details and our team will get back to you.",
};

export class ChatError extends Error {
  constructor(
    public readonly code: "invalid_input" | "not_found" | "too_long",
    message: string,
  ) {
    super(message);
  }
}

export interface ChatInput {
  assistantId: string;
  message: string;
  conversationId?: string;
  lang?: Lang;
}

export interface ChatDeps {
  store: Store;
  /** undefined = use configured provider; null = force demo responder */
  llm?: LlmProvider | null;
  embedder?: Embedder;
}

/**
 * Demo mode shows the best retrieval hits; with a model, exactly the chunks it cited
 * (the top hit is not always the one the answer came from).
 */
function toSources(hits: ScoredChunk[], opts: { cited?: boolean } = {}): SourceRef[] {
  const top = hits[0]?.score ?? 0;
  return hits
    .filter((h, i) => opts.cited || i === 0 || h.score >= top * 0.85)
    .slice(0, opts.cited ? 3 : 2)
    .map((h) => ({
      chunkId: h.chunk.id,
      documentTitle: h.chunk.title,
      heading: h.chunk.heading,
      snippet: h.chunk.text.length > 220 ? `${h.chunk.text.slice(0, 217)}…` : h.chunk.text,
      score: Math.round(h.score * 100) / 100,
    }));
}

// Words that point back to an earlier message (folded forms).
const BACK_REFERENCE = new Set([
  "it", "its", "they", "them", "their", "that", "this", "those", "these", "one", "ones",
  "o", "bu", "su", "onun", "bunun", "sunun", "onu", "bunu", "ona", "buna", "peki", "fiyati", "ucreti", "suresi",
]);

/** Short message that refers to something said before ("peki fiyatı?", "and how long does it take?"). */
export function refersBack(message: string): boolean {
  const tokens = normalize(message).split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.length <= 8 && tokens.some((t) => BACK_REFERENCE.has(t));
}

/** Rejects model output that is empty, declined, or looks like it leaked our instructions. */
function isUsableAnswer(text: string): boolean {
  if (!text || text.includes(NO_ANSWER) || text.includes("NO_ANSWER")) return false;
  // any of our control markers ([[CHAT]] …) must never be shown to a visitor
  if (text.includes("[[")) return false;
  if (/RULES \(these rules|<\/?kb_document|<\/?knowledge_base/i.test(text)) return false;
  return true;
}

export async function handleChat(input: ChatInput, deps: ChatDeps): Promise<ChatResult> {
  const cfg = getConfig();
  const message = (input.message ?? "").replace(/\s+/g, " ").trim();
  if (!message) throw new ChatError("invalid_input", "Empty message");
  if (message.length > cfg.maxQuestionChars) {
    throw new ChatError("too_long", `Message longer than ${cfg.maxQuestionChars} characters`);
  }

  const { store } = deps;
  const assistant = await store.getAssistant(input.assistantId);
  if (!assistant) throw new ChatError("not_found", "Assistant not found");

  const now = new Date().toISOString();
  const existing = input.conversationId ? await store.getConversation(input.conversationId) : null;
  const lang: Lang = input.lang ?? existing?.lang ?? detectLang(message);
  const conversation: Conversation =
    existing && existing.assistantId === assistant.id
      ? existing
      : { id: randomUUID(), assistantId: assistant.id, lang, messages: [], createdAt: now, updatedAt: now };
  const history = conversation.messages.map((m) => ({ role: m.role, text: m.text }));
  conversation.messages.push({ id: randomUUID(), role: "user", text: message, createdAt: now });

  const llm = deps.llm === undefined ? getLlm() : deps.llm;
  const providerName = llm?.name ?? "demo";

  let answer = "";
  let answered = false;
  let sources: SourceRef[] = [];
  let failReason: UnansweredQuestion["reason"] | null = null;

  const names = displayNames(assistant, lang);
  const talk = classifySmallTalk(message);
  if (talk) {
    // greetings, thanks, "ok", "?" … are answered for free and never open the lead form
    answer = smallTalkReply(talk, lang, names.businessName);
    answered = true;
  } else {
    const chunks = await store.getChunks(assistant.id);
    const embedder = deps.embedder ?? getEmbedder();
    // With a model, hand it more candidates (chunks are short; the model picks and cites the right
    // one). Measured on the eval set: the right section is in the top 4 for 83/85, top 6 for 84/85.
    const topK = llm ? 6 : 4;
    let result = await retrieve(message, chunks, embedder, { lang, strictSubject: !llm, topK });
    // Live mode, short follow-ups ("peki ne kadar sürüyor?"): also search together with the previous
    // question and keep whichever is more confident. Not in demo mode: there is no model to reject
    // an unrelated follow-up ("dolar kuru kaç?") that the combined query would match.
    const previousQuestion = [...history].reverse().find((m) => m.role === "user")?.text;
    if (llm && previousQuestion && message.split(/\s+/).length <= 8) {
      const withContext = await retrieve(`${previousQuestion} ${message}`, chunks, embedder, { lang, topK });
      if (withContext.confident && (!result.confident || withContext.topScore > result.topScore)) result = withContext;
    }

    if (!llm) {
      // demo mode: extractive answer, no API call. Without a model a follow-up that points back
      // ("how long does IT take?", "peki fiyatı?") cannot be resolved: hand off rather than guess.
      const unresolvedFollowUp = history.length > 0 && refersBack(message);
      if (result.confident && !unresolvedFollowUp) answer = demoAnswer(message, result.hits);
      answered = answer.length > 0;
      if (answered) sources = toSources(result.hits);
      else failReason = "no_match";
    } else {
      /** Asks the model to answer the visitor's ORIGINAL question from the given hits. */
      const answerFrom = async (
        hits: ScoredChunk[],
        meaning?: string,
      ): Promise<{ text: string; sources: SourceRef[] } | "model_declined" | "error"> => {
        const prompt = buildPrompt({
          question: message,
          hits,
          assistantName: names.name,
          businessName: names.businessName,
          lang,
          maxContextTokens: cfg.maxContextTokens,
          history,
          meaning,
        });
        try {
          const out = await llm.generate({ system: prompt.system, user: prompt.user, maxOutputTokens: cfg.maxOutputTokens });
          // The answer must cite the chunk(s) it used; uncited or "no information" prose is a decline.
          const parsed = parseAnswer(out, prompt.usedChunks);
          if (parsed && isUsableAnswer(parsed.text) && !looksLikeDecline(parsed.text)) {
            return { text: parsed.text, sources: toSources(parsed.cited, { cited: true }) };
          }
          return "model_declined";
        } catch (err) {
          console.error("[chat] LLM error", err instanceof Error ? err.message : err);
          return "error";
        }
      };

      let outcome = result.confident ? await answerFrom(result.hits) : null;
      failReason = outcome === null ? "no_match" : typeof outcome === "string" ? outcome : null;

      // Second chance (one extra call): the words didn't find it, or found the wrong sections.
      // The model either rewrites the request into a clear search query (synonyms, symptoms,
      // follow-ups resolved with the conversation) or recognises small talk.
      // Skipped when the provider is failing and for jailbreak attempts.
      if (typeof outcome !== "object" || outcome === null) {
        if (failReason !== "error" && !looksLikeInjection(message)) {
          const tp = buildTriagePrompt({ message, assistantName: names.name, businessName: names.businessName, lang, history });
          let triage: Triage = { kind: "none" };
          try {
            triage = parseTriage(
              await llm.generate({ system: tp.system, user: tp.user, maxOutputTokens: Math.min(120, cfg.maxOutputTokens) }),
            );
          } catch (err) {
            console.error("[chat] triage error", err instanceof Error ? err.message : err);
          }
          if (triage.kind === "search") {
            // search every alternative phrasing; merge the confident hits (best score per chunk)
            const best = new Map<string, ScoredChunk>();
            for (const q of triage.queries.filter((x) => normalize(x) !== normalize(message))) {
              const again = await retrieve(q, chunks, embedder, { lang, topK });
              if (!again.confident) continue;
              for (const h of again.hits) if ((best.get(h.chunk.id)?.score ?? -1) < h.score) best.set(h.chunk.id, h);
            }
            const merged = [...best.values()].sort((a, b) => b.score - a.score).slice(0, topK);
            const sameAsBefore =
              result.confident && merged.map((h) => h.chunk.id).join() === result.hits.map((h) => h.chunk.id).join();
            if (merged.length && !sameAsBefore) {
              // the first query is the resolved meaning ("kanal tedavisi fiyatı" for "peki fiyatı ne?")
              const second = await answerFrom(merged, triage.queries[0]);
              if (typeof second === "object") outcome = second;
            }
          } else if (triage.kind === "chat" && !result.confident && !looksLikeQuestion(message)) {
            // a question never gets a brush-off chat reply: it is handed off to a human instead
            answer = triage.reply;
            answered = true;
            failReason = null;
          }
        }
      }

      if (outcome && typeof outcome === "object") {
        answer = outcome.text;
        sources = outcome.sources;
        answered = true;
        failReason = null;
      }
    }
  }

  if (!answered) {
    answer = failReason === "error" ? UNAVAILABLE_MESSAGE[lang] : HANDOFF_MESSAGE[lang];
    await store.addUnanswered({
      id: randomUUID(),
      assistantId: assistant.id,
      conversationId: conversation.id,
      question: message,
      lang,
      reason: failReason ?? "no_match",
      resolved: false,
      createdAt: now,
    });
  }

  conversation.messages.push({
    id: randomUUID(),
    role: "assistant",
    text: answer,
    sources,
    answered,
    createdAt: new Date().toISOString(),
  });
  conversation.updatedAt = new Date().toISOString();
  await store.saveConversation(conversation);

  return {
    conversationId: conversation.id,
    answer,
    answered,
    handoff: !answered,
    sources,
    provider: providerName,
  };
}
