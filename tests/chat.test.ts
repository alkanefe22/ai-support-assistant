import { describe, expect, it, vi } from "vitest";
import { ChatError, HANDOFF_MESSAGE, handleChat } from "@/lib/chat";
import type { LlmProvider } from "@/lib/llm";
import { NO_ANSWER } from "@/lib/prompt";
import { localEmbedder } from "@/lib/rag/embeddings";
import { ingestDocument } from "@/lib/rag/ingest";
import { DEMO_ASSISTANT_ID } from "@/lib/seed";
import { seededStore, tempStore } from "./helpers";

const deps = async () => ({ store: await seededStore(), llm: null, embedder: localEmbedder });

describe("chat in demo mode (no API calls)", () => {
  it("answers from the knowledge base and cites the source", async () => {
    const d = await deps();
    const res = await handleChat({ assistantId: DEMO_ASSISTANT_ID, message: "Diş beyazlatma ne kadar?" }, d);
    expect(res.answered).toBe(true);
    expect(res.handoff).toBe(false);
    expect(res.provider).toBe("demo");
    expect(res.answer).toContain("6.500 TL");
    expect(res.sources[0]).toMatchObject({ documentTitle: "Sıkça Sorulan Sorular (TR)" });
    expect(res.sources[0].heading).toMatch(/beyazlatma/);
  });

  it("returns short FAQ answers whole (does not drop a leading 'No')", async () => {
    const d = await deps();
    await ingestDocument(
      d.store,
      {
        assistantId: DEMO_ASSISTANT_ID,
        title: "Ek",
        lang: "tr",
        sourceType: "faq",
        text: "S: Göz muayenesi yapıyor musunuz?\nC: Hayır, yalnızca diş tedavisi yapıyoruz. Bir göz doktoruna başvurun.",
      },
      localEmbedder,
    );
    const res = await handleChat({ assistantId: DEMO_ASSISTANT_ID, message: "Göz muayenesi yapıyor musunuz?" }, d);
    expect(res.answered).toBe(true);
    expect(res.answer).toBe("Hayır, yalnızca diş tedavisi yapıyoruz. Bir göz doktoruna başvurun.");
    expect(res.sources[0].documentTitle).toBe("Ek");
  });

  it("answers in English with English sources", async () => {
    const d = await deps();
    const res = await handleChat({ assistantId: DEMO_ASSISTANT_ID, message: "Do you have parking?", lang: "en" }, d);
    expect(res.answered).toBe(true);
    expect(res.answer).toMatch(/parking/i);
    expect(res.sources[0].documentTitle).toMatch(/EN/);
  });

  it("says it doesn't know instead of inventing, and logs the question", async () => {
    const d = await deps();
    const res = await handleChat({ assistantId: DEMO_ASSISTANT_ID, message: "Göz muayenesi yapıyor musunuz?" }, d);
    expect(res.answered).toBe(false);
    expect(res.handoff).toBe(true);
    expect(res.answer).toBe(HANDOFF_MESSAGE.tr);
    expect(res.sources).toEqual([]);
    const unanswered = await d.store.listUnanswered(DEMO_ASSISTANT_ID);
    expect(unanswered).toHaveLength(1);
    expect(unanswered[0]).toMatchObject({ question: "Göz muayenesi yapıyor musunuz?", reason: "no_match", resolved: false });
  });

  it("uses the English hand-off message for English visitors", async () => {
    const d = await deps();
    const res = await handleChat({ assistantId: DEMO_ASSISTANT_ID, message: "Do you sell laptops?", lang: "en" }, d);
    expect(res.answer).toBe(HANDOFF_MESSAGE.en);
  });

  it("replies to small talk with a recorded answer", async () => {
    const d = await deps();
    const res = await handleChat({ assistantId: DEMO_ASSISTANT_ID, message: "Merhaba!" }, d);
    expect(res.answered).toBe(true);
    expect(res.answer).toMatch(/yardımcı/);
  });

  it("keeps the conversation history in one conversation", async () => {
    const d = await deps();
    const a = await handleChat({ assistantId: DEMO_ASSISTANT_ID, message: "Çalışma saatleriniz?" }, d);
    const b = await handleChat({ assistantId: DEMO_ASSISTANT_ID, message: "Otopark var mı?", conversationId: a.conversationId }, d);
    expect(b.conversationId).toBe(a.conversationId);
    const conv = await d.store.getConversation(a.conversationId);
    expect(conv?.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("rejects empty and over-long questions (per-request limit)", async () => {
    const d = await deps();
    await expect(handleChat({ assistantId: DEMO_ASSISTANT_ID, message: "   " }, d)).rejects.toBeInstanceOf(ChatError);
    await expect(
      handleChat({ assistantId: DEMO_ASSISTANT_ID, message: "a".repeat(501) }, d),
    ).rejects.toMatchObject({ code: "too_long" });
  });

  it("rejects unknown assistants", async () => {
    await expect(
      handleChat({ assistantId: "nope", message: "hi" }, { store: tempStore(), llm: null }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("chat with a (mocked) remote model", () => {
  const model = (reply: string | Error): LlmProvider => ({
    name: "claude",
    generate: vi.fn(async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    }),
  });

  it("hands off when the model says the context has no answer", async () => {
    const d = await deps();
    const res = await handleChat(
      { assistantId: DEMO_ASSISTANT_ID, message: "İmplant kaç yıl dayanır?" },
      { ...d, llm: model(NO_ANSWER) },
    );
    expect(res.handoff).toBe(true);
    expect((await d.store.listUnanswered(DEMO_ASSISTANT_ID))[0].reason).toBe("model_declined");
  });

  it("hands off (and does not crash) when the provider fails", async () => {
    const d = await deps();
    const res = await handleChat(
      { assistantId: DEMO_ASSISTANT_ID, message: "İmplant fiyatı nedir?" },
      { ...d, llm: model(new Error("503")) },
    );
    expect(res.handoff).toBe(true);
    expect((await d.store.listUnanswered(DEMO_ASSISTANT_ID))[0].reason).toBe("error");
  });

  it("bounds the prompt by the context token budget", async () => {
    const d = await deps();
    const llm = model("İmplant 22.000 TL'den başlar.");
    await handleChat({ assistantId: DEMO_ASSISTANT_ID, message: "İmplant fiyatı nedir?" }, { ...d, llm });
    const call = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // MAX_CONTEXT_TOKENS default 1500 ≈ 6000 chars of documents + fixed scaffolding
    expect(call.user.length).toBeLessThan(6000 + 1500);
    expect(call.maxOutputTokens).toBe(350);
  });
});
