# REPORT — AI Support Assistant (gece çalışması, 24.09.2026)

## Özet

MVP bitti ve demo modunda uçtan uca çalışıyor: bilgi tabanı → hibrit arama → kaynaklı cevap / "bilmiyorum" →
lead formu → yönetim paneli. Hiçbir canlı API çağrısı yapılmadı, hiçbir şey push/deploy edilmedi, global paket
kurulmadı, hesap ayarı değiştirilmedi. Tüm iş yerel git geçmişinde (7 commit, bu düzeltme dahil).

## Ne bitti

| Parça | Durum |
|---|---|
| Bilgi tabanı: PDF/TXT/MD yükleme, SSS metni yapıştırma, silme, yeniden indeksleme | ✅ |
| Chunk (başlık/SSS farkındalıklı) + embedding (`local` ücretsiz / `gemini`) + hibrit arama | ✅ |
| Türkçe desteği: aksan katlama, kök alma, ek varyasyonu eşleşmesi, küçük eşanlamlı listesi | ✅ |
| "Bilmiyorum" davranışı: güven eşiği + model `NO_ANSWER` sentinel'i + hata durumunda yönlendirme | ✅ |
| Her cevapta kaynak parça (belge adı, bölüm başlığı, alıntı) | ✅ |
| Lead toplama (KVKK onay kutusu zorunlu, e-posta/telefon doğrulama, lead rate limit) | ✅ |
| Yönetim paneli: genel bakış, bilgi tabanı, ayarlar (ad/renk/karşılama TR-EN/izinli domainler), sohbet geçmişi, cevaplanamayanlar (gruplu, sayılı, çözüldü işareti), leadler + CSV | ✅ |
| Çoklu asistan (panelden yeni işletme oluşturma) | ✅ |
| Widget: tek script, Shadow DOM, 10,6 KB (gzip 4,3 KB), mobilde tam ekran, klavye erişimi, XSS-güvenli | ✅ |
| Demo sitesi: kurgusal Gülümse Diş Kliniği, TR + EN bilgi tabanı ve sayfa | ✅ |
| Sağlayıcı seçimi env'den: `demo` / `gemini` / `claude`; anahtar yoksa otomatik demo | ✅ (canlı test edilmedi) |
| Rate limit (IP/dk), günlük limit, soru uzunluğu, bağlam token bütçesi, çıktı token sınırı | ✅ |
| Prompt injection savunması + testleri | ✅ |
| Admin auth: `ADMIN_PASSWORD` + HMAC cookie; canlı modda şifre yoksa panel kilitli | ✅ |
| README: Mermaid mimari, 11 ekran görüntüsü, kurulum, env tablosu, gizlilik notu, üretim alternatifleri | ✅ |

## Ne test edildi

**Otomatik (`npm test`, 77/77 geçti, ağ erişimi yok):**
- Retrieval: 22 alan içi TR/EN soru doğru bölümü buluyor; 11 alan dışı soru (hava durumu, kek tarifi, göz muayenesi, laptop…) eşiği geçemiyor.
- Sohbet: kaynaklı cevap, EN cevap, bilmiyorum + cevaplanamayan kaydı, kısa SSS cevaplarının tam dönmesi, selamlama, geçmiş, uzunluk sınırı, bilinmeyen asistan.
- Sahte (mock) modelle: `NO_ANSWER` → yönlendirme, sağlayıcı hatası → çökmeden yönlendirme, bağlam bütçesi ve `max_tokens` iletimi.
- Injection: TR/EN tespit kalıpları, normal bilgi tabanında yanlış alarm yok, sahte `</kb_document><system>` kaçışlanıyor, bilgi tabanı metni asla sistem rolüne girmiyor, zehirli belgeden cevapta enjekte metin yok, ziyaretçi jailbreak'i modele ulaşmıyor, sistem promptunu sızdıran çıktı reddediliyor.
- PDF: test içinde üretilen gerçek bir PDF'ten metin çıkarma → indeksleme → cevaplama.
- Chunker, Türkçe normalizasyon, embedding benzerliği, rate limiter pencere mantığı.

**Elle (tarayıcıda, `npm run build && npm start`):**
- Demo sayfası TR: soru → kaynaklı cevap; bilinmeyen soru → yönlendirme → lead formu gönderildi → panelde lead ve cevaplanamayan soru göründü.
- Demo sayfası EN + mobil (375 px) tam ekran widget.
- Panelden SSS metni eklendi, asistan yeni bilgiyle hemen cevap verdi.
- curl ile: CORS preflight, 9. istekte `429`, lead doğrulama hataları (`invalid_contact`, `consent_required`), bilinmeyen asistan `404`.
- `npm run typecheck` ve `npm run build` (Next.js 16.3) temiz.

## Eksikler / bilinen sınırlamalar

- **Canlı Gemini/Claude çağrıları hiç çalıştırılmadı** (kural gereği). Kod resmi REST uçlarına göre yazıldı ama gerçek
  yanıt biçimi, model adları (`gemini-2.5-flash`, `claude-haiku-4-5`) ve `gemini` embedding eşiği (0.55) doğrulanmadı.
- **Panelden PDF yükleme butonu tarayıcıda tıklanarak denenmedi** (tarayıcı aracım dosya seçemiyor). PDF ayrıştırma ve
  indeksleme testle doğrulandı; server action yolu (`uploadDocument`) aynı fonksiyonları çağırıyor.
- `local` embedding anlamsal değil: eşanlamlı/çok farklı ifade edilmiş sorularda (ör. "ağız kokusu" ↔ "halitozis") ıskalar.
  Gerçek kullanımda `EMBEDDING_PROVIDER=gemini` önerilir.
- Yerel JSON veritabanı tek süreç içindir; Vercel'de `/tmp`'de geçicidir. Rate limit bellek içidir (instance başına).
- Widget cevapları stream etmiyor (MVP kararı), cevap tek seferde geliyor.
- Widget başlığındaki işletme adı dile göre değişmiyor (EN sayfada da "Gülümse Diş Kliniği").
- Yeni lead için e-posta/webhook bildirimi yok; işletme panelden bakmalı.

## Senin yapman gerekenler

1. **Dosyaları kalıcı bir klasöre taşı.** Proje şu an bu oturum için açılmış geçici bir çalışma klasöründe; oturum
   silinirse klasör de silinir. İstersen bana bir klasör söyle, oturumu oraya taşıyayım.
2. Kodu gözden geçir, uygun görürsen GitHub'a kendin push et (ben push etmedim).
3. Canlı modu denemek için `.env.local` oluştur (`.env.example`'dan):
   `AI_PROVIDER=gemini` + `GEMINI_API_KEY` (veya `claude` + `ANTHROPIC_API_KEY`), güçlü bir `ADMIN_PASSWORD` ve
   `SESSION_SECRET`. İlk denemede düşük limitlerle (`DAILY_REQUEST_LIMIT=20`) birkaç soru sor; model adlarının güncel
   olduğunu kontrol et. Gemini embedding'e geçersen panelden **Yeniden indeksle** ve "bilmiyorum" eşiğini gözle kontrol et.
4. Vercel'e deploy kararı senin: demo için olduğu gibi çalışır; gerçek müşteri için README'deki "Deploy ve üretim notları"
   (Postgres + pgvector, Upstash Redis) uygulanmalı.
5. Gerçek bir işletmeyle kullanmadan önce KVKK aydınlatma metni ve veri işleme sözleşmelerini hazırla (README → Gizlilik notu).

## Komutlar

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```
