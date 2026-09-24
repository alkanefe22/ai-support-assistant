import { randomUUID } from "node:crypto";
import { getConfig } from "./config";
import { getLlm, type LlmProvider } from "./llm";
import { demoAnswer, recordedReply } from "./llm/demo";
import { buildPrompt, NO_ANSWER } from "./prompt";
import { getEmbedder, type Embedder } from "./rag/embeddings";
import { retrieve, type ScoredChunk } from "./rag/retrieval";
import { detectLang } from "./rag/text";
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

function toSources(hits: ScoredChunk[]): SourceRef[] {
  const top = hits[0]?.score ?? 0;
  return hits
    .filter((h, i) => i === 0 || h.score >= top * 0.85)
    .slice(0, 2)
    .map((h) => ({
      chunkId: h.chunk.id,
      documentTitle: h.chunk.title,
      heading: h.chunk.heading,
      snippet: h.chunk.text.length > 220 ? `${h.chunk.text.slice(0, 217)}…` : h.chunk.text,
      score: Math.round(h.score * 100) / 100,
    }));
}

/** Rejects model output that is empty, declined, or looks like it leaked our instructions. */
function isUsableAnswer(text: string): boolean {
  if (!text || text.includes(NO_ANSWER) || text.includes("NO_ANSWER")) return false;
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

  const small = recordedReply(message, lang);
  if (small) {
    answer = small;
    answered = true;
  } else {
    const chunks = await store.getChunks(assistant.id);
    const result = await retrieve(message, chunks, deps.embedder ?? getEmbedder(), { lang });
    if (!result.confident) {
      failReason = "no_match";
    } else if (llm) {
      const names = displayNames(assistant, lang);
      const prompt = buildPrompt({
        question: message,
        hits: result.hits,
        assistantName: names.name,
        businessName: names.businessName,
        lang,
        maxContextTokens: cfg.maxContextTokens,
        history,
      });
      try {
        const out = await llm.generate({
          system: prompt.system,
          user: prompt.user,
          maxOutputTokens: cfg.maxOutputTokens,
        });
        if (isUsableAnswer(out)) {
          answer = out;
          answered = true;
          sources = toSources(prompt.usedChunks);
        } else {
          failReason = "model_declined";
        }
      } catch (err) {
        console.error("[chat] LLM error", err instanceof Error ? err.message : err);
        failReason = "error";
      }
    } else {
      answer = demoAnswer(message, result.hits);
      answered = answer.length > 0;
      if (answered) sources = toSources(result.hits);
      else failReason = "no_match";
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
