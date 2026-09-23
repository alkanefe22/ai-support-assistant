import { beforeAll, describe, expect, it } from "vitest";
import { localEmbedder } from "@/lib/rag/embeddings";
import { retrieve } from "@/lib/rag/retrieval";
import { DEMO_ASSISTANT_ID } from "@/lib/seed";
import type { Chunk, Lang } from "@/lib/types";
import { seededStore } from "./helpers";

let chunks: Chunk[];

beforeAll(async () => {
  const store = await seededStore();
  chunks = await store.getChunks(DEMO_ASSISTANT_ID);
});

const IN_DOMAIN: [Lang, string, RegExp][] = [
  ["tr", "Pazar günü açık mısınız?", /Çalışma saatleriniz/],
  ["tr", "saat kaçta kapanıyorsunuz", /Çalışma saatleriniz/],
  ["tr", "diş beyazlatma ne kadar", /beyazlatma/],
  ["tr", "dis beyazlatma fiyati", /beyazlatma/], // no Turkish characters
  ["tr", "İmplant fiyatları nedir?", /İmplant/],
  ["tr", "taksit yapıyor musunuz", /Ödeme/],
  ["tr", "kliniğin adresi nerede", /Klinik nerede/],
  ["tr", "otopark var mı", /Klinik nerede/],
  ["tr", "randevu nasıl alırım", /randevu/i],
  ["tr", "ilk muayene ücretli mi", /İlk muayene/],
  ["tr", "şeffaf plak tedavisi yapıyor musunuz", /Ortodonti/],
  ["tr", "çocuğum 4 yaşında bakıyor musunuz", /Çocuklara/],
  ["tr", "SGK geçiyor mu", /Sigorta/],
  ["tr", "dişim çok ağrıyor acil", /Acil/],
  ["tr", "dolgu garantisi kaç yıl", /garanti/i],
  ["en", "What are your opening hours?", /opening hours/],
  ["en", "how much is teeth whitening", /whitening/],
  ["en", "do you accept installments", /payment/i],
  ["en", "is there parking", /Where is the clinic/],
  ["en", "do you treat kids", /children/],
  ["en", "do you speak english", /languages/],
  ["en", "how long do implants take", /implants/],
];

const OUT_OF_DOMAIN: [Lang, string][] = [
  ["tr", "Yarın İstanbul'da hava nasıl olacak?"],
  ["tr", "Bana bir kek tarifi verir misin?"],
  ["tr", "Galatasaray maçı kaç kaç bitti?"],
  ["tr", "Araba kaskosu yaptırmak istiyorum"],
  ["tr", "Dolar kuru bugün kaç TL?"],
  ["tr", "Göz muayenesi yapıyor musunuz?"],
  ["en", "What's the weather like tomorrow?"],
  ["en", "Write me a poem about the sea"],
  ["en", "Who won the football match last night?"],
  ["en", "Can you fix my car engine?"],
  ["en", "Do you sell laptops?"],
];

describe("retrieval on the demo knowledge base", () => {
  it.each(IN_DOMAIN)("[%s] %s → finds the right section", async (lang, q, heading) => {
    const r = await retrieve(q, chunks, localEmbedder, { lang });
    expect(r.confident, `score ${r.topScore.toFixed(3)}`).toBe(true);
    expect(r.hits[0].chunk.heading).toMatch(heading);
  });

  it.each(OUT_OF_DOMAIN)("[%s] %s → not confident (no answer)", async (lang, q) => {
    const r = await retrieve(q, chunks, localEmbedder, { lang });
    expect(r.confident, `top: ${r.hits[0]?.chunk.heading} ${r.topScore.toFixed(3)} cov ${r.hits[0]?.coverage.toFixed(2)}`).toBe(false);
  });

  it("prefers chunks in the visitor's language", async () => {
    const r = await retrieve("implant", chunks, localEmbedder, { lang: "en" });
    expect(r.hits.every((h) => h.chunk.lang === "en")).toBe(true);
  });

  it("returns nothing for an empty knowledge base", async () => {
    const r = await retrieve("çalışma saatleri", [], localEmbedder);
    expect(r).toEqual({ hits: [], confident: false, topScore: 0 });
  });
});
