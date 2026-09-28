# NEXT_STEPS: projeye döndüğünde

Sırayla ilerle. Her madde tek başına bitirilebilir.

## 0. Ortamı aç (2 dk)

1. `npm install`
2. `.env.local` yerinde mi kontrol et (repoda yok, yalnızca bu bilgisayarda). Yoksa `.env.example`'dan oluştur.
3. `npm test` → 274/274 geçmeli.

## 1. Canlı modu uçtan uca doğrula (~3 dk, 8 sohbet + 10 embedding çağrısı)

1. `npm run live-check`
2. Beklenen: 4 soru cevaplanır (halitozis ve diş teli eşanlamlıları dahil), 4 soru yönlendirilir (kanal, yirmilik diş, root canal, veneer).
3. `!` (sağlayıcı hatası) görürsen tekrar deneme; birkaç saat sonra bir kez daha çalıştır.
4. `✗` görürsen: model ya bilgi tabanında olmayan soruya cevap uydurmuş (→ `src/lib/prompt.ts` kurallarını sıkılaştır) ya da cevabı olan soruyu reddetmiş (→ çıktıyı incele, gerekirse `MAX_CONTEXT_TOKENS`'ı artır).
5. Sonucu README'deki "Canlı mod durumu" tablosuna yaz (⏳ → ✅).

## 1b. Yerel modelle sınırsız test (Ollama, ücretsiz)

1. Ollama kurulu ve çalışıyor olsun: `ollama pull gemma3:12b` ve `ollama pull bge-m3`.
2. `.env.local` içinde: `AI_PROVIDER=ollama`, `EMBEDDING_PROVIDER=ollama` (Gemini satırları dursun, geri dönmek için değiştirmen yeter).
3. `npm run calibrate` → çıktının sonundaki üç `RETRIEVAL_*` satırını `.env.local`'e yapıştır (bge-m3'ün eşiği Gemini'ninkinden farklıdır).
4. `npm run live-check` (12 soru) ve `npm run eval` (5 işletme, 289 soru, ~3,5 dk; `EVAL_REPEAT=3` ile kararlılık). Son sonuç 867/867.
5. Uygulamayı denemek için `npm run dev`, sonra panelden **Yeniden indeksle** (bilgi tabanı bge-m3 ile yeniden gömülsün).

## 2. Vercel'e public demo olarak deploy et (~10 dk, ücretsiz)

1. vercel.com → **Add New → Project** → GitHub'dan `alkanefe22/ai-support-assistant`'ı içe aktar (framework otomatik: Next.js).
2. Environment Variables:
   - `PUBLIC_DEMO=true`
   - `AI_PROVIDER=demo` (ücretsiz; Gemini'yi açacaksan `gemini` + `GEMINI_API_KEY`, `DAILY_REQUEST_LIMIT=20`)
   - `ADMIN_PASSWORD=` güçlü bir şifre, `SESSION_SECRET=` 64+ karakter rastgele değer
3. **Deploy**. Build komutu `npm run build` (widget'ı da derler), ek ayar gerekmez.
4. Kontrol et: `/demo` cevap veriyor, `/admin` salt okunur bandıyla açılıyor, "Yönetici girişi" ile şifre çalışıyor.
5. Bilinen sınır: veritabanı `/tmp`'de, her soğuk başlangıçta demo verisine döner (public demo için sorun değil).
   **`/try` için önemli:** Vercel'de deneme asistanları ve "sitemde istiyorum" leadleri de `/tmp`'de durur ve bir sonraki
   soğuk başlangıçta kaybolur. `/try`'ı gerçek müşteri adaylarına açmadan önce 4.1'deki kalıcı veritabanı gerekir
   (ya da `/try`'ı sürekli çalışan tek bir sunucuda, ör. küçük bir VPS'te `npm run start:public-demo -- --live` ile yayınla).
6. `/try`'ı gerçek yapay zekâyla aç: `AI_PROVIDER=gemini` + `EMBEDDING_PROVIDER=gemini`, `RATE_LIMIT_PER_MINUTE=10`,
   `DAILY_REQUEST_LIMIT` ve `TRY_DAILY_LIMIT` bütçene göre. Demo modu (kelime eşleştirme) SSS tarzı sayfalarda iyi,
   serbest yazılmış sitelerde zayıf kalır; müşteri adayına "vay" dedirtecek olan canlı moddur.

## 3. Canlı demo linkini README'ye ekle

1. `README.md` → "**Live demo:** _yakında…_" satırını gerçek URL ile değiştir.
2. GitHub repo sayfasında **About → Website** alanına da aynı URL'yi yaz.
3. Commit + push.

## 3b. İlk müşteri adaylarını getir (`/try` ile)

1. `/try` linkini hedef sektördeki 20-30 işletmeye (diş kliniği, kuaför, e-ticaret, restoran) gönder: "Sitenizin adresini
   yazın, 1 dakikada kendi müşteri asistanınızı görün."
2. Panel → **Denemeler**: kim denedi, kaç soru sordu, hangi sorular cevapsız kaldı, kim "sitemde istiyorum" dedi.
3. "Sitemde istiyorum" diyenlere 24 saat içinde dön; deneme asistanı 7 gün saklanır, kurulumu ondan devam ettir.

## 4. Micro-SaaS için eksikler (öncelik sırasıyla)

1. **Kalıcı veritabanı:** Postgres + pgvector (Neon, Vercel Marketplace). `src/lib/store/types.ts`'teki `Store` arayüzünü uygula; vektör aramasını SQL'e taşı. Rate limit için Upstash Redis.
2. **Çoklu müşteri:** gerçek hesaplar (Clerk / Auth.js), her işletme yalnızca kendi asistanlarını görsün; `assistantId` sahiplik kontrolü tüm server action'lara.
3. **KVKK metni:** aydınlatma metni + açık rıza sayfası, widget'taki onay kutusundan link; saklama süresi ve otomatik silme; sağlayıcılarla veri işleme sözleşmesi.
4. **Ödeme:** abonelik planları (örn. mesaj/ay kotası), Stripe veya iyzico; plan limitini `DAILY_REQUEST_LIMIT` yerine veritabanından oku.
5. Yeni lead için e-posta/webhook bildirimi.
6. Cevapları stream etme (küçük UX işi).
