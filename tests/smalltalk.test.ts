import { describe, expect, it, vi } from "vitest";
import { HANDOFF_MESSAGE, handleChat } from "@/lib/chat";
import type { LlmProvider } from "@/lib/llm";
import { CHAT_MARK, NO_ANSWER, parseChatReply } from "@/lib/prompt";
import { localEmbedder } from "@/lib/rag/embeddings";
import { DEMO_ASSISTANT_ID } from "@/lib/seed";
import { classifySmallTalk, editDistance } from "@/lib/smalltalk";
import { seededStore } from "./helpers";

describe("small-talk classifier (no API call)", () => {
  it.each([
    "slm", "Slm!!", "slmmm", "selam", "selm", "selamlar", "sa", "mrb", "merhaba", "merhaa", "mrhaba", "merhabaaa",
    "Merhaba kanka", "iyi günler", "günaydın", "naber", "nasılsın", "kolay gelsin", "hi", "hello there", "Hey!",
    "good morning",
  ])("greeting: %j", (m) => {
    expect(classifySmallTalk(m)).toBe("greeting");
  });

  it.each(["tşk", "teşekkürler", "tesekurler", "çok teşekkür ederim", "sağol", "eyv", "thanks a lot", "thank you"])(
    "thanks: %j",
    (m) => expect(classifySmallTalk(m)).toBe("thanks"),
  );

  it.each(["görüşürüz", "hoşça kal", "bye", "iyi geceler"])("bye: %j", (m) => {
    expect(classifySmallTalk(m)).toBe("bye");
  });

  it.each(["ok", "tamam", "tmm", "peki", "hmm", "evet", "anladım", "süper"])("acknowledgement: %j", (m) => {
    expect(classifySmallTalk(m)).toBe("ack");
  });

  it.each(["?", "...", "😊", "ne?", "nasıl?", "x"])("unclear: %j", (m) => {
    expect(classifySmallTalk(m)).toBe("unclear");
  });

  it.each([
    "merhaba implant fiyatı ne",
    "slm diş beyazlatma ne kadar",
    "fiyat?",
    "randevu",
    "kolay mı",
    "Selim Bey'e randevu almak istiyorum",
    "Göz muayenesi yapıyor musunuz?",
    "how much is whitening",
  ])("a real question is NOT small talk: %j", (m) => {
    expect(classifySmallTalk(m)).toBeNull();
  });

  it("edit distance handles insertions, deletions and swaps", () => {
    expect(editDistance("merhaa", "merhaba")).toBe(1);
    expect(editDistance("mrhaba", "merhaba")).toBe(1);
    expect(editDistance("selma", "selam")).toBe(1); // adjacent swap
    expect(editDistance("implant", "merhaba")).toBeGreaterThan(2);
  });
});

describe("chat: small talk never opens the lead form", () => {
  const deps = async () => ({ store: await seededStore(), llm: null, embedder: localEmbedder });

  it.each(["slm", "merhaa", "tşk", "tamam", "?"])("%j gets a friendly reply, no hand-off, nothing logged", async (m) => {
    const d = await deps();
    const res = await handleChat({ assistantId: DEMO_ASSISTANT_ID, message: m, lang: "tr" }, d);
    expect(res.answered).toBe(true);
    expect(res.handoff).toBe(false);
    expect(res.answer).not.toBe(HANDOFF_MESSAGE.tr);
    expect(await d.store.listUnanswered(DEMO_ASSISTANT_ID)).toEqual([]);
  });

  it("greets with the business name in the visitor's language", async () => {
    const d = await deps();
    const tr = await handleChat({ assistantId: DEMO_ASSISTANT_ID, message: "slm", lang: "tr" }, d);
    const en = await handleChat({ assistantId: DEMO_ASSISTANT_ID, message: "hi", lang: "en" }, d);
    expect(tr.answer).toContain("Gülümse Diş Kliniği");
    expect(en.answer).toContain("Gülümse Dental Clinic");
  });

  it("slang and fillers around a real question do not break search", async () => {
    const d = await deps();
    const res = await handleChat(
      { assistantId: DEMO_ASSISTANT_ID, message: "slm kanka diş beyazlatma ne kadar", lang: "tr" },
      d,
    );
    expect(res.answered).toBe(true);
    expect(res.answer).toContain("6.500 TL");
  });
});

describe("live mode: chit-chat the rules miss goes to the model, facts never do", () => {
  function model(reply: string | Error): LlmProvider & { generate: ReturnType<typeof vi.fn> } {
    return {
      name: "gemini",
      generate: vi.fn(async () => {
        if (reply instanceof Error) throw reply;
        return reply;
      }),
    };
  }
  const run = async (message: string, llm: LlmProvider) => {
    const store = await seededStore();
    const res = await handleChat({ assistantId: DEMO_ASSISTANT_ID, message, lang: "tr" }, { store, llm, embedder: localEmbedder });
    return { res, unanswered: await store.listUnanswered(DEMO_ASSISTANT_ID) };
  };

  it("obvious small talk is answered by the rules, the model is not called (free)", async () => {
    const llm = model("should not be called");
    const { res } = await run("slm", llm);
    expect(llm.generate).not.toHaveBeenCalled();
    expect(res.answered).toBe(true);
  });

  it("chit-chat without a KB match gets a conversational model reply", async () => {
    const llm = model(`${CHAT_MARK} Ne güzel! Size diş tedavilerimizle ilgili nasıl yardımcı olabilirim?`);
    const { res, unanswered } = await run("bugün keyfim yerinde be", llm);
    expect(llm.generate).toHaveBeenCalledOnce();
    const call = llm.generate.mock.calls[0][0];
    expect(call.maxOutputTokens).toBeLessThanOrEqual(120);
    expect(call.system).toContain(CHAT_MARK);
    expect(call.user).toContain("<visitor_message>");
    expect(res.answered).toBe(true);
    expect(res.handoff).toBe(false);
    expect(res.sources).toEqual([]);
    expect(res.answer).toBe("Ne güzel! Size diş tedavilerimizle ilgili nasıl yardımcı olabilirim?");
    expect(unanswered).toEqual([]);
  });

  it("an information request without a KB match is still handed off", async () => {
    const { res, unanswered } = await run("Göz muayenesi yapıyor musunuz?", model(NO_ANSWER));
    expect(res.handoff).toBe(true);
    expect(res.answer).toBe(HANDOFF_MESSAGE.tr);
    expect(unanswered[0].reason).toBe("no_match");
  });

  it.each([
    [`${CHAT_MARK} Göz muayenesi 500 TL'dir.`, "invented number"],
    [`${CHAT_MARK} Bize info@ornek.com adresinden yazın.`, "invented e-mail"],
    [`${CHAT_MARK} Detaylar https://ornek.com adresinde.`, "invented link"],
    ["Merhaba, size yardımcı olabilirim.", "missing chat mark"],
    [`${CHAT_MARK} ${"uzun ".repeat(80)}`, "too long"],
  ])("a fallback reply with %s is rejected (%s)", async (reply) => {
    const { res } = await run("bugün keyfim yerinde be", model(reply));
    expect(res.handoff).toBe(true);
  });

  it("if the fallback call fails the visitor gets the normal hand-off, not 'unavailable'", async () => {
    const { res, unanswered } = await run("bugün keyfim yerinde be", model(new Error("503")));
    expect(res.answer).toBe(HANDOFF_MESSAGE.tr);
    expect(unanswered[0].reason).toBe("no_match");
  });

  it("parseChatReply accepts only clean, marked replies", () => {
    expect(parseChatReply(`${CHAT_MARK} Merhaba!`)).toBe("Merhaba!");
    expect(parseChatReply(`  ${CHAT_MARK}   Hoş geldiniz.  `)).toBe("Hoş geldiniz.");
    expect(parseChatReply(NO_ANSWER)).toBeNull();
    expect(parseChatReply(`${CHAT_MARK}`)).toBeNull();
    expect(parseChatReply(`${CHAT_MARK} RULES: ...`)).toBeNull();
  });
});
