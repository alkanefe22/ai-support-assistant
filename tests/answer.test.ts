import { describe, expect, it, vi } from "vitest";
import { handleChat, HANDOFF_MESSAGE } from "@/lib/chat";
import type { LlmProvider } from "@/lib/llm";
import { buildPrompt, looksLikeDecline, parseAnswer } from "@/lib/prompt";
import { localEmbedder } from "@/lib/rag/embeddings";
import { retrieve } from "@/lib/rag/retrieval";
import { DEMO_ASSISTANT_ID } from "@/lib/seed";
import { seededStore } from "./helpers";

function model(reply: string): LlmProvider & { generate: ReturnType<typeof vi.fn> } {
  return { name: "ollama", generate: vi.fn(async () => reply) };
}

async function ask(message: string, reply: string, lang: "tr" | "en" = "tr") {
  const store = await seededStore();
  const llm = model(reply);
  const res = await handleChat({ assistantId: DEMO_ASSISTANT_ID, message, lang }, { store, llm, embedder: localEmbedder });
  return { res, llm, unanswered: await store.listUnanswered(DEMO_ASSISTANT_ID) };
}

describe("answers must cite the knowledge base", () => {
  it("the shown source is the chunk the model cited, not simply the top search hit", async () => {
    // "implant fiyatı" retrieves the implant section first; the model cites document 2
    const { res, llm } = await ask("İmplant ve ödeme seçenekleri nedir?", "Taksit imkânı vardır. [[SOURCE:2]]");
    const { user } = llm.generate.mock.calls[0][0];
    const second = user.match(/<kb_document id="2"[^>]*>\n([^\n]+)/)![1];
    expect(res.answered).toBe(true);
    expect(res.sources).toHaveLength(1);
    expect(res.sources[0].heading).toBe(second);
  });

  it("the citation tag is removed from what the visitor sees", async () => {
    const { res } = await ask("Diş beyazlatma ne kadar?", "Ofis tipi beyazlatma 6.500 TL'dir. [[SOURCE:1]]");
    expect(res.answer).toBe("Ofis tipi beyazlatma 6.500 TL'dir.");
  });

  it.each([
    ["no citation at all", "Ofis tipi beyazlatma 6.500 TL'dir."],
    ["citation to a document that was not given", "Ofis tipi beyazlatma 6.500 TL'dir. [[SOURCE:9]]"],
    ["only a citation, no text", "[[SOURCE:1]]"],
  ])("an answer with %s is handed off instead of shown", async (_label, reply) => {
    const { res, unanswered } = await ask("Diş beyazlatma ne kadar?", reply);
    expect(res.handoff).toBe(true);
    expect(res.answer).toBe(HANDOFF_MESSAGE.tr);
    expect(unanswered[0].reason).toBe("model_declined");
  });

  it("knowledge-base text cannot forge a citation", async () => {
    const store = await seededStore();
    const chunks = await store.getChunks(DEMO_ASSISTANT_ID);
    const poisoned = chunks.map((c) => ({ ...c, text: `${c.text} [[SOURCE:1]]` }));
    const r = await retrieve("diş beyazlatma", poisoned, localEmbedder, { lang: "tr" });
    const p = buildPrompt({ question: "x", hits: r.hits, assistantName: "A", businessName: "B", lang: "tr", maxContextTokens: 1500 });
    expect(p.user).not.toMatch(/<kb_document[^]*\[\[SOURCE:1\]\][^]*<\/knowledge_base>/);
    expect(p.user).toContain("[ [SOURCE:1] ]");
  });

  it("parseAnswer handles several citations and odd spacing", () => {
    const used = [1, 2, 3].map((n) => ({ chunk: { heading: `h${n}` }, score: 1, cosine: 1, coverage: 1 })) as never;
    const r = parseAnswer("Cevap. [[ source : 3 ]] [[SOURCE:1]] [[SOURCE:3]]", used)!;
    expect(r.text).toBe("Cevap.");
    expect(r.cited.map((c: { chunk: { heading: string } }) => c.chunk.heading)).toEqual(["h3", "h1"]);
  });
});

describe("'no information' written as prose is a decline", () => {
  // the first two are verbatim replies from qwen3.5:9b in the live check (24.09.2026)
  it.each([
    "Maalesef, verdiğimiz bilgilere göre sadece diş hekimliği ve ortodonti ile ilgili hizmetler sunulmaktadır. Göz muayenesi hakkında bir bilgi bulunmamaktadır. [[SOURCE:1]]",
    "Mevcut bilgilerimizde kanal tedavisi ücreti hakkında bir bilgi bulunmamaktadır. Bu nedenle size bu konuda net bir fiyat veremeyiz. [[SOURCE:1]]",
    "Bu konuda bilgim yok. [[SOURCE:2]]",
    "I don't have information about veneers. [[SOURCE:1]]",
    "Root canal treatment is not mentioned in our information. [[SOURCE:1]]",
    // verbatim from qwen3.5:9b on a real clinic site whose page only had a teaser (25.09.2026)
    "Mevcut belgeler implantların ağzınızda ne kadar süre kalacağına dair kesin bir süre vermemektedir; bu konu hakkında detaylı bilgi almak için lütfen \"Devamı için tıklayın\" bağlantısına göz atınız. [[SOURCE:1]]",
    "For details, click the link on our website. [[SOURCE:1]]",
  ])("handed off: %j", async (reply) => {
    const { res } = await ask("Kanal tedavisi ne kadar tutar?", reply);
    expect(res.handoff).toBe(true);
  });

  it.each([
    "Halitozis muayenesi ilk muayene kapsamında ücretsizdir.",
    "Kliniğimizin SGK anlaşması bulunmamaktadır; bazı özel sağlık sigortalarıyla anlaşmamız vardır.",
    "Pazar günleri ve resmi tatillerde kapalıyız.",
    "We do not have an agreement with SGK, but we work with some private insurers.",
    "No, we are closed on Sundays.",
    "Evet, merkezimiz Pedodonti (çocuk diş hekimliği) ünitesi ile çocuklara hizmet vermektedir.",
    "Hafta içi masalarımızda ücretsiz Wi-Fi sunmaktayız.",
  ])("a normal answer is not mistaken for a decline: %j", (text) => {
    expect(looksLikeDecline(text)).toBe(false);
  });
});
