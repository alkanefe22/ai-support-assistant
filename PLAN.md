# AI Support Assistant — Plan

Bir işletmenin dokümanlarından (PDF / TXT / Markdown / SSS metni) bilgi tabanı oluşturan,
sitesine tek satırlık script ile gömülen ve **yalnızca bilgi tabanından, kaynak göstererek**
cevap veren destek asistanı. Bilgi yoksa uydurmaz, ziyaretçiyi yetkiliye yönlendirir ve lead toplar.

## MVP kapsamı

| Parça | Kapsam |
|---|---|
| Bilgi tabanı | Yükleme (PDF/TXT/MD) + yapıştırılan SSS metni, silme, yeniden indeksleme. Chunk + embedding + hibrit arama |
| Sohbet API | Retrieval → güven eşiği → LLM (veya demo yanıtlayıcı) → kaynaklı cevap / "bilmiyorum" + lead akışı |
| Yönetim paneli | Bilgi tabanı, asistan ayarları (ad, renk, karşılama TR/EN, izinli domainler), sohbet geçmişi, cevaplanamayan sorular, leadler |
| Widget | `<script src=".../widget.js" data-assistant="...">`, Shadow DOM, mobil uyumlu, bağımlılıksız, ~10 KB |
| Demo sitesi | Kurgusal "Gülümse Diş Kliniği" (TR/EN), hazır bilgi tabanı, widget canlı |
| Sağlayıcılar | `AI_PROVIDER=demo \| gemini \| claude` (env). Anahtar yoksa otomatik demo |
| Koruma | IP bazlı rate limit, asistan başı günlük limit, soru uzunluğu / bağlam / çıktı token sınırı |
| Güvenlik | Prompt injection: bilgi tabanı metni veri bloğu içinde, ayraçlar kaçışlanır, şüpheli içerik işaretlenir; testli |

**Kapsam dışı (MVP):** çok kullanıcılı hesap/kayıt, ödeme, streaming yanıt, harici vektör DB, e-posta bildirimi.

## Teknik kararlar

- **Next.js (App Router) + TypeScript + Tailwind v4**, Vercel uyumlu (Node runtime).
- **Veri katmanı:** `Store` arayüzü + yerelde **JSON dosya deposu** (`data/db.json`, sıfır kurulum,
  native modül yok). Vercel'de `/tmp`'ye düşer (geçici). Üretim alternatifi README'de: Postgres + pgvector (Neon) + Upstash Redis.
- **Embedding:** `local` (hash'lenmiş, Türkçe için ilk-5-karakter kök + karakter trigram vektörü; ücretsiz, çevrimdışı)
  veya `gemini` (`gemini-embedding-001`). Claude'un embedding API'si olmadığından Claude modunda local embedding kullanılır.
- **Arama:** kosinüs benzerliği + sorgu terimi kapsama oranı (hibrit). Mutlak eşiğin altındaysa LLM'e hiç gidilmez → "bilmiyorum".
- **LLM:** SDK yerine doğrudan `fetch` (Gemini `generateContent`, Anthropic Messages API). Model env'den.
- **Demo yanıtlayıcı:** Retrieval gerçek çalışır; üretim yerine en ilgili parçadan ekstraktif cevap + önceden kaydedilmiş
  selamlama/teşekkür yanıtları. Maliyet sıfır.
- **Widget:** `widget/widget.ts` → esbuild → `public/widget.js`.
- **Admin auth:** `ADMIN_PASSWORD` env + HMAC imzalı cookie. Tanımsızsa yalnızca demo modunda açık erişim (uyarı bandı).
- **Testler:** Vitest (chunker, retrieval, bilmiyorum, injection, rate limit, chat uçtan uca demo modunda).
- **Ekran görüntüleri:** `playwright-core` + sistemde kurulu Edge/Chrome (tarayıcı indirmeden).

## Klasör yapısı

```
PLAN.md  README.md  REPORT.md  .env.example
data/
  seed/                 # demo bilgi tabanı (TR/EN markdown)
  db.json               # yerel veritabanı (gitignore)
docs/screenshots/       # README görselleri
public/widget.js        # derlenmiş widget
scripts/
  seed.ts               # demo asistan + bilgi tabanını kurar
  screenshots.ts        # README ekran görüntüleri
src/
  app/
    page.tsx            # landing
    demo/page.tsx       # demo klinik sitesi (TR/EN)
    admin/              # panel: login, knowledge, settings, conversations, unanswered, leads
    api/chat            # widget sohbet ucu (CORS)
    api/widget/config   # widget ayarları (CORS)
    api/leads           # lead kaydı (CORS)
  lib/
    config.ts  types.ts  auth.ts  ratelimit.ts  cors.ts
    store/              # Store arayüzü + JSON uygulaması
    rag/                # text normalize, chunker, embeddings, retrieval, ingest, parse
    llm/                # provider seçimi, gemini, claude, demo
    prompt.ts           # sistem promptu + injection savunması
    chat.ts             # orkestrasyon
widget/widget.ts
tests/
```

## Uygulama sırası (her adımda commit)

1. İskelet: Next.js + TS + Tailwind + Vitest, git init
2. Çekirdek: store, chunker, embeddings, retrieval, prompt, LLM sağlayıcıları, chat orkestrasyonu, rate limit
3. Testler: retrieval, bilmiyorum, injection, rate limit
4. API uçları + widget
5. Demo bilgi tabanı + seed + demo sitesi
6. Yönetim paneli
7. README (Mermaid, ekran görüntüleri, kurulum, gizlilik), REPORT.md
