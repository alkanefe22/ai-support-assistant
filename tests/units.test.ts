import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/rag/chunker";
import { cosine, localEmbed } from "@/lib/rag/embeddings";
import { detectLang, normalize, stemMatch } from "@/lib/rag/text";
import { SlidingWindowLimiter } from "@/lib/ratelimit";

describe("chunker", () => {
  it("splits markdown by headings and keeps the heading", () => {
    const chunks = chunkText("# Başlık\nGiriş.\n\n## Soru bir?\nCevap bir.\n\n## Soru iki?\nCevap iki.");
    expect(chunks.map((c) => c.heading)).toEqual(["Başlık", "Soru bir?", "Soru iki?"]);
    expect(chunks[1].text).toBe("Cevap bir.");
  });

  it("recognises plain-text FAQ (S:/C: and question lines)", () => {
    const chunks = chunkText("S: Kargo ücretli mi?\nC: 500 TL üzeri ücretsiz.\n\nİade süresi nedir?\n14 gündür.");
    expect(chunks).toEqual([
      { heading: "Kargo ücretli mi?", text: "500 TL üzeri ücretsiz." },
      { heading: "İade süresi nedir?", text: "14 gündür." },
    ]);
  });

  it("never produces chunks much larger than maxChars", () => {
    const long = Array.from({ length: 80 }, (_, i) => `Bu ${i}. cümledir ve biraz uzundur.`).join(" ");
    const chunks = chunkText(long, { maxChars: 300 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(300 + 120);
  });

  it("recognises plain-text section titles in capitals or ending with a colon", () => {
    const chunks = chunkText(
      "S: Kargo ücretli mi?\nC: 750 TL üzeri ücretsiz.\n\nİADE VE DEĞİŞİM POLİTİKASI\n\nÜrünleri 14 gün içinde iade edebilirsiniz.\n\nGaranti koşulları:\nİki yıl garanti verilir.",
    );
    expect(chunks.map((c) => c.heading)).toEqual(["Kargo ücretli mi?", "İADE VE DEĞİŞİM POLİTİKASI", "Garanti koşulları"]);
    expect(chunks[1].text).toBe("Ürünleri 14 gün içinde iade edebilirsiniz.");
  });

  it("does not mistake ordinary sentences, prices or codes for titles", () => {
    const chunks = chunkText("## Fiyat\nTSE belgeli cihaz.\nFiyat: 7.900 TL dahil.\nKDV DAHİL FİYATTIR.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading).toBe("Fiyat");
  });

  it("returns nothing for empty input", () => {
    expect(chunkText("  \n\n ")).toEqual([]);
  });
});

describe("text utilities", () => {
  it("folds Turkish characters", () => {
    expect(normalize("DİŞ Işık ÇĞÖŞÜ")).toBe("dis isik cgosu");
  });
  it("matches Turkish suffix variants", () => {
    expect(stemMatch("gunu", "gunle")).toBe(false);
    expect(stemMatch("gun", "gunle")).toBe(true);
    expect(stemMatch("kapan", "kapal")).toBe(true);
    expect(stemMatch("ab", "abcde")).toBe(false);
  });
  it("detects language", () => {
    expect(detectLang("Fiyatınız nedir?")).toBe("tr");
    expect(detectLang("What is the price?")).toBe("en");
  });
  it("local embeddings are normalized and similar for similar text", () => {
    const a = localEmbed("diş beyazlatma fiyatı");
    const b = localEmbed("dis beyazlatma ucreti");
    const c = localEmbed("kargo teslimat süresi");
    expect(cosine(a, a)).toBeCloseTo(1, 5);
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
  });
});

describe("rate limiter", () => {
  it("allows N requests per window, then blocks with retry-after", () => {
    const rl = new SlidingWindowLimiter(3, 60_000);
    const t = 1_000_000;
    expect(rl.check("ip", t).ok).toBe(true);
    expect(rl.check("ip", t + 1).ok).toBe(true);
    expect(rl.check("ip", t + 2).ok).toBe(true);
    const blocked = rl.check("ip", t + 3);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);
    expect(rl.check("other-ip", t + 3).ok).toBe(true);
    expect(rl.check("ip", t + 60_001).ok).toBe(true); // window slid
  });
});
