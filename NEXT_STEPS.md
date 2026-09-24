# NEXT_STEPS: projeye döndüğünde

Sırayla ilerle. Her madde tek başına bitirilebilir.

## 0. Ortamı aç (2 dk)

1. `npm install`
2. `.env.local` yerinde mi kontrol et (repoda yok, yalnızca bu bilgisayarda). Yoksa `.env.example`'dan oluştur.
3. `npm test` → 178/178 geçmeli.

## 1. Canlı modu uçtan uca doğrula (~3 dk, 8 sohbet + 10 embedding çağrısı)

1. `npm run live-check`
2. Beklenen: 4 soru cevaplanır (halitozis ve diş teli eşanlamlıları dahil), 4 soru yönlendirilir (kanal, yirmilik diş, root canal, veneer).
3. `!` (sağlayıcı hatası) görürsen tekrar deneme; birkaç saat sonra bir kez daha çalıştır.
4. `✗` görürsen: model ya bilgi tabanında olmayan soruya cevap uydurmuş (→ `src/lib/prompt.ts` kurallarını sıkılaştır) ya da cevabı olan soruyu reddetmiş (→ çıktıyı incele, gerekirse `MAX_CONTEXT_TOKENS`'ı artır).
5. Sonucu README'deki "Canlı mod durumu" tablosuna yaz (⏳ → ✅).

## 2. Vercel'e public demo olarak deploy et (~10 dk, ücretsiz)

1. vercel.com → **Add New → Project** → GitHub'dan `alkanefe22/ai-support-assistant`'ı içe aktar (framework otomatik: Next.js).
2. Environment Variables:
   - `PUBLIC_DEMO=true`
   - `AI_PROVIDER=demo` (ücretsiz; Gemini'yi açacaksan `gemini` + `GEMINI_API_KEY`, `DAILY_REQUEST_LIMIT=20`)
   - `ADMIN_PASSWORD=` güçlü bir şifre, `SESSION_SECRET=` 64+ karakter rastgele değer
3. **Deploy**. Build komutu `npm run build` (widget'ı da derler), ek ayar gerekmez.
4. Kontrol et: `/demo` cevap veriyor, `/admin` salt okunur bandıyla açılıyor, "Yönetici girişi" ile şifre çalışıyor.
5. Bilinen sınır: veritabanı `/tmp`'de, her soğuk başlangıçta demo verisine döner (public demo için sorun değil).

## 3. Canlı demo linkini README'ye ekle

1. `README.md` → "**Live demo:** _yakında…_" satırını gerçek URL ile değiştir.
2. GitHub repo sayfasında **About → Website** alanına da aynı URL'yi yaz.
3. Commit + push.

## 4. Micro-SaaS için eksikler (öncelik sırasıyla)

1. **Kalıcı veritabanı:** Postgres + pgvector (Neon, Vercel Marketplace). `src/lib/store/types.ts`'teki `Store` arayüzünü uygula; vektör aramasını SQL'e taşı. Rate limit için Upstash Redis.
2. **Çoklu müşteri:** gerçek hesaplar (Clerk / Auth.js), her işletme yalnızca kendi asistanlarını görsün; `assistantId` sahiplik kontrolü tüm server action'lara.
3. **KVKK metni:** aydınlatma metni + açık rıza sayfası, widget'taki onay kutusundan link; saklama süresi ve otomatik silme; sağlayıcılarla veri işleme sözleşmesi.
4. **Ödeme:** abonelik planları (örn. mesaj/ay kotası), Stripe veya iyzico; plan limitini `DAILY_REQUEST_LIMIT` yerine veritabanından oku.
5. Yeni lead için e-posta/webhook bildirimi.
6. Cevapları stream etme (küçük UX işi).
