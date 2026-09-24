import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { handleChat } from "@/lib/chat";
import { localEmbedder } from "@/lib/rag/embeddings";
import { crawlSite, extractPage, isPublicAddress, rankLinks, safeFetch } from "@/lib/try/fetchsite";
import { cleanupExpiredTrials, createTrial, isActiveTrial, normalizeUrl, TrialError } from "@/lib/try/trial";
import { tempStore } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TRY_ALLOW_PRIVATE;
});

// ------------------------------------------------------------------ a tiny fake business site

const SITE: Record<string, { status?: number; location?: string; type?: string; body?: string }> = {
  "https://kahve.example/": {
    body: `<!doctype html><html lang="tr"><head><title>Kahve Durağı | Nitelikli kahve</title>
      <meta property="og:site_name" content="Kahve Durağı"><meta name="theme-color" content="#7c2d12"></head>
      <body><nav><a href="/">Ana sayfa</a> <a href="/sss">SSS</a> <a href="/fiyatlar">Fiyatlar</a> <a href="/blog/2019/eski-yazi">Blog</a>
      <a href="/sepet">Sepet</a> <a href="https://baska-site.example/">Dış</a> <a href="/logo.png">Logo</a></nav>
      <script>var secret = "do not index";</script><style>.x{}</style>
      <h1>Kahve Durağı&apos;na hoş geldiniz</h1><p>Moda&#39;da 2015&apos;ten beri nitelikli kahve &amp; tatlı.</p>
      <div class="cookie-banner">Çerezleri kabul ediyor musunuz?</div></body></html>`,
  },
  "https://kahve.example/sss": {
    body: `<html><body><h2>Sıkça Sorulan Sorular</h2>
      <h3>Çalışma saatleriniz nedir?</h3><p>Her gün 08:00 - 22:00 arası açığız. Pazar günleri 10:00'da açılırız.</p>
      <h3>Laptopla çalışabilir miyim?</h3><p>Evet, hafta içi masalarımızda priz ve ücretsiz Wi-Fi vardır. Hafta sonu 2 saat sınırı uygulanır.</p>
      <h3>Evcil hayvan kabul ediyor musunuz?</h3><p>Evet, bahçe bölümümüzde evcil hayvanlar kabul edilir.</p></body></html>`,
  },
  "https://kahve.example/fiyatlar": {
    body: `<html><body><h2>Fiyat listesi</h2><ul><li>Filtre kahve: 95 TL</li><li>Latte: 120 TL</li><li>San Sebastian: 160 TL</li></ul>
      <p>Kendi bardağınızı getirirseniz 10 TL indirim yapılır. Ödemede tüm kartlar ve nakit geçerlidir.</p></body></html>`,
  },
  "https://kahve.example/blog/2019/eski-yazi": { body: "<html><body><p>Kısa.</p></body></html>" },
  "https://redirect.example/": { status: 302, location: "https://kahve.example/" },
  "https://evil.example/": { status: 302, location: "http://127.0.0.1/admin" },
  "https://pdf.example/": { type: "application/pdf", body: "%PDF" },
};

function fakeWeb() {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      const url = String(input);
      calls.push(url);
      const page = SITE[url];
      if (!page) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
      const headers: Record<string, string> = { "content-type": page.type ?? "text/html; charset=utf-8" };
      if (page.location) headers.location = page.location;
      return new Response(page.body ?? "", { status: page.status ?? 200, headers });
    }),
  );
  return calls;
}

describe("extractPage", () => {
  const info = extractPage(SITE["https://kahve.example/"].body!, new URL("https://kahve.example/"));

  it("reads title, site name, brand colour and language", () => {
    expect(info).toMatchObject({ title: "Kahve Durağı | Nitelikli kahve", siteName: "Kahve Durağı", themeColor: "#7c2d12", lang: "tr" });
  });
  it("keeps readable text with markdown headings and decoded entities", () => {
    expect(info.text).toContain("## Kahve Durağı'na hoş geldiniz");
    expect(info.text).toContain("Moda'da 2015'ten beri nitelikli kahve & tatlı.");
  });
  it("drops scripts, styles, navigation and cookie banners", () => {
    expect(info.text).not.toMatch(/secret|\.x\{|Ana sayfa|Çerezleri/);
  });
  it("collects same-site links only", () => {
    expect(info.links).toContain("https://kahve.example/sss");
    expect(info.links.some((l) => l.includes("baska-site"))).toBe(false);
  });
  it("turns list items into bullet lines the chunker understands", () => {
    const p = extractPage(SITE["https://kahve.example/fiyatlar"].body!, new URL("https://kahve.example/fiyatlar"));
    expect(p.text).toContain("- Filtre kahve: 95 TL");
  });
});

describe("rankLinks", () => {
  it("puts FAQ / price / contact pages first and skips carts, files and the start page", () => {
    const start = new URL("https://kahve.example/");
    const ranked = rankLinks(
      ["https://kahve.example/", "https://kahve.example/blog/2019/eski-yazi", "https://kahve.example/fiyatlar", "https://kahve.example/sepet", "https://kahve.example/logo.png", "https://kahve.example/sss"],
      start,
    );
    expect(ranked.slice(0, 2).sort()).toEqual(["https://kahve.example/fiyatlar", "https://kahve.example/sss"]);
    expect(ranked).not.toContain("https://kahve.example/sepet");
    expect(ranked).not.toContain("https://kahve.example/logo.png");
    expect(ranked).not.toContain("https://kahve.example/");
  });
});

describe("SSRF protection", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])(
    "%s is not public",
    (ip) => expect(isPublicAddress(ip)).toBe(false),
  );
  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])("%s is public", (ip) => expect(isPublicAddress(ip)).toBe(true));

  it.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://printer.local/",
    "file:///etc/passwd",
    "https://93.184.216.34:8080/",
    "https://user:pass@93.184.216.34/",
  ])("refuses %s before any request is made", async (url) => {
    const calls = fakeWeb();
    await expect(safeFetch(url)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("re-checks every redirect hop: a public page redirecting to localhost is blocked", async () => {
    SITE["http://93.184.216.34/"] = { status: 302, location: "http://127.0.0.1/admin" };
    const calls = fakeWeb();
    await expect(safeFetch("http://93.184.216.34/")).rejects.toThrow(/okunamaz/);
    expect(calls).toEqual(["http://93.184.216.34/"]);
  });

  it("refuses non-HTML responses", async () => {
    process.env.TRY_ALLOW_PRIVATE = "1";
    fakeWeb();
    await expect(safeFetch("https://pdf.example/")).rejects.toThrow(/web sayfası değil/);
  });
});

describe("crawlSite (fake site, network checks disabled)", () => {
  it("reads the home page plus the most relevant pages, follows redirects, skips thin pages", async () => {
    process.env.TRY_ALLOW_PRIVATE = "1";
    const calls = fakeWeb();
    const site = await crawlSite("https://redirect.example/", 8);
    expect(site.businessName).toBe("Kahve Durağı");
    expect(site.themeColor).toBe("#7c2d12");
    expect(site.pages.map((p) => p.url)).toEqual(["https://kahve.example/", "https://kahve.example/sss", "https://kahve.example/fiyatlar"]);
    expect(calls).not.toContain("https://kahve.example/sepet");
    expect(calls.some((c) => c.includes("baska-site"))).toBe(false);
  });

  it("stops at the page limit", async () => {
    process.env.TRY_ALLOW_PRIVATE = "1";
    fakeWeb();
    const site = await crawlSite("https://kahve.example/", 2);
    expect(site.pages).toHaveLength(2);
  });
});

describe("createTrial", () => {
  let store: ReturnType<typeof tempStore>;
  beforeAll(() => {
    store = tempStore();
  });

  it("builds a working temporary assistant from a website", async () => {
    process.env.TRY_ALLOW_PRIVATE = "1";
    fakeWeb();
    const t = await createTrial(store, { url: "kahve.example" }, localEmbedder);
    expect(t.assistant.id).toMatch(/^try-[0-9a-f]{12}$/);
    expect(t.assistant).toMatchObject({ businessName: "Kahve Durağı", color: "#7c2d12" });
    expect(t.assistant.trial).toMatchObject({ source: "https://kahve.example/" });
    expect(t.pages).toHaveLength(3);
    expect(t.suggestions).toContain("Laptopla çalışabilir miyim?");
    expect(isActiveTrial(t.assistant)).toBe(true);

    // and it answers from the site, with a source, without any API (demo responder)
    const res = await handleChat({ assistantId: t.assistant.id, message: "Latte kaç lira?", lang: "tr" }, { store, llm: null, embedder: localEmbedder });
    expect(res.answered).toBe(true);
    expect(res.answer).toContain("120 TL");
  });

  it("works from pasted text too", async () => {
    const t = await createTrial(
      store,
      { text: "S: Kargo ücretli mi?\nC: 500 TL üzeri siparişlerde kargo ücretsizdir, altında 49 TL'dir.\n\nS: İade süresi nedir?\nC: 14 gün içinde iade edebilirsiniz.\n\nS: Hangi kargo firması?\nC: Aras Kargo ile gönderiyoruz, takip numarası SMS ile gelir.", businessName: "Test Mağaza" },
      localEmbedder,
    );
    expect(t.assistant.businessName).toBe("Test Mağaza");
    expect(t.chunks).toBeGreaterThanOrEqual(3);
  });

  it("finds opening hours written as 'açığız' (k→ğ), not the intro that says 'çalışırız'", async () => {
    const t = await createTrial(
      store,
      {
        text: "## Kedileri de yıkıyor musunuz?\nEvet, kediler için sessiz odada banyo yapıyoruz. İşlem yaklaşık 1 saat sürer.\n\n## Hoş geldiniz\nKadıköy'de 2018'den beri kedi ve köpekler için tıraş, banyo ve tırnak bakımı yapıyoruz. Randevulu çalışırız, aynı anda tek hayvanla ilgileniriz.\n\n## İletişim\nAdres: Moda Cad. No: 12, Kadıköy / İstanbul. Telefon: 0216 555 12 34. Salı-Pazar 10:00-19:00 açığız, Pazartesi kapalıyız.",
        businessName: "Pati",
      },
      localEmbedder,
    );
    for (const q of ["Çalışma saatleriniz nedir?", "Pazartesi açık mısınız?", "Adresiniz nerede?"]) {
      const res = await handleChat({ assistantId: t.assistant.id, message: q, lang: "tr" }, { store, llm: null, embedder: localEmbedder });
      expect(res.answer, q).toContain(q.startsWith("Adres") ? "No: 12, Kadıköy" : "10:00-19:00");
    }
  });

  it("returns a short price list whole in demo mode, not its first three items", async () => {
    const t = await createTrial(
      store,
      { text: "## Fiyatlar\n- Küçük ırk köpek tıraşı: 900 TL\n- Büyük ırk köpek tıraşı: 1.500 TL\n- Kedi banyosu: 700 TL\n- Tırnak kesimi: 200 TL\n\n## Randevu\nTelefonla veya WhatsApp üzerinden randevu alabilirsiniz. İptal en geç 24 saat önce yapılmalıdır.", businessName: "Pati" },
      localEmbedder,
    );
    const res = await handleChat({ assistantId: t.assistant.id, message: "Fiyatlarınız nedir?", lang: "tr" }, { store, llm: null, embedder: localEmbedder });
    expect(res.answer).toContain("Tırnak kesimi: 200 TL");
    expect(res.answer.split("\n")).toHaveLength(4);
  });

  it("explains itself when there is not enough text", async () => {
    await expect(createTrial(store, { text: "Merhaba." }, localEmbedder)).rejects.toBeInstanceOf(TrialError);
  });

  it("rejects a blocked address with a readable message", async () => {
    fakeWeb();
    await expect(createTrial(store, { url: "http://127.0.0.1/" }, localEmbedder)).rejects.toThrow(/okunamaz/);
  });

  it("normalises what people type as an address", () => {
    expect(normalizeUrl("ornek.com")).toBe("https://ornek.com/");
    expect(normalizeUrl(" http://ornek.com/sss ")).toBe("http://ornek.com/sss");
    expect(() => normalizeUrl("ornek")).toThrow(TrialError);
  });

  it("expired trials are deleted with everything they own; normal assistants never are", async () => {
    const s = tempStore();
    await s.saveAssistant({ id: "real", name: "R", businessName: "R", color: "#000000", welcome: { tr: "", en: "" }, allowedOrigins: [], createdAt: "" });
    const t = await createTrial(s, { text: "S: A nedir?\nC: A bir test cevabıdır ve yeterince uzun olması için birkaç kelime daha içerir.\n\nS: B nedir?\nC: B de bir test cevabıdır, bu metin denemenin oluşturulabilmesi için yeterli uzunluktadır.\n\nS: C nedir?\nC: C üçüncü test cevabıdır ve toplam metni eşiğin üzerine çıkarır.", businessName: "X" }, localEmbedder);
    await s.addLead({ id: randomUUID(), assistantId: t.assistant.id, name: "a", contact: "a@b.co", question: "", lang: "tr", createdAt: "" });
    const later = Date.parse(t.assistant.trial!.expiresAt) + 1000;
    expect(await cleanupExpiredTrials(s, later)).toBe(1);
    expect(await s.getAssistant(t.assistant.id)).toBeNull();
    expect(await s.getChunks(t.assistant.id)).toEqual([]);
    expect(await s.listLeads(t.assistant.id)).toEqual([]);
    expect(await s.getAssistant("real")).not.toBeNull();
  });
});

describe("/api/try and interest routes", () => {
  beforeAll(() => {
    process.env.DATA_DIR = path.join(os.tmpdir(), "aisa-try-tests", randomUUID());
    process.env.TRY_PER_IP_PER_HOUR = "2";
    delete (globalThis as { __store?: unknown }).__store;
    delete (globalThis as { __tryLimiter?: unknown }).__tryLimiter;
  });

  const post = async (fields: Record<string, string>, ip = "1.1.1.1") => {
    const { POST } = await import("@/app/api/try/route");
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return POST(new Request("http://localhost/api/try", { method: "POST", body: fd, headers: { "x-forwarded-for": ip } }));
  };
  const text = "S: Kargo ücretli mi?\nC: 500 TL üzeri siparişlerde kargo ücretsizdir, altında 49 TL'dir.\n\nS: İade süresi nedir?\nC: 14 gün içinde iade edebilirsiniz, ürün kullanılmamış olmalıdır.\n\nS: Hangi kargo firması?\nC: Aras Kargo ile gönderiyoruz, takip numarası SMS ile gelir.";

  it("requires the ownership consent", async () => {
    const res = await post({ text });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/onaylayın/);
  });

  it("creates a trial and limits each visitor per hour", async () => {
    const a = await post({ text, consent: "1", businessName: "Deneme" }, "2.2.2.2");
    expect(a.status).toBe(200);
    const body = await a.json();
    expect(body.previewUrl).toMatch(/^\/try\/try-/);
    expect((await post({ text, consent: "1" }, "2.2.2.2")).status).toBe(200);
    expect((await post({ text, consent: "1" }, "2.2.2.2")).status).toBe(429);
    expect((await post({ text, consent: "1" }, "3.3.3.3")).status).toBe(200);

    // "add this to my site" → a lead on the trial, marked interested, kept for a week
    const { POST: interest } = await import("@/app/api/try/[id]/interest/route");
    const call = (b: object) =>
      interest(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(b), headers: { "x-forwarded-for": "4.4.4.4" } }), {
        params: Promise.resolve({ id: body.id }),
      });
    expect((await call({ name: "Ali", contact: "bozuk", consent: true })).status).toBe(400);
    expect((await call({ name: "Ali", contact: "ali@ornek.com" })).status).toBe(400);
    expect((await call({ name: "Ali", contact: "ali@ornek.com", consent: true })).status).toBe(201);
    const { getStore } = await import("@/lib/store");
    const store = await getStore();
    const a2 = await store.getAssistant(body.id);
    expect(a2?.trial?.interested).toBe(true);
    expect(Date.parse(a2!.trial!.expiresAt)).toBeGreaterThan(Date.now() + 6 * 24 * 3_600_000);
    expect((await store.listLeads(body.id))[0]).toMatchObject({ name: "Ali", contact: "ali@ornek.com" });
  });

  it("the admin assistant switcher never lists trials", async () => {
    vi.doMock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
    const { currentAssistant } = await import("@/app/admin/current");
    const { all } = await currentAssistant();
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((a) => a.trial)).toBe(false);
    vi.doUnmock("next/headers");
  });
});
