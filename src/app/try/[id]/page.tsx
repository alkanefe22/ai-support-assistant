import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/store";
import { isActiveTrial, suggestionText } from "@/lib/try/trial";
import { AskButtons, InterestForm } from "./TryClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Asistanınız hazır — deneme", robots: { index: false } };

const GENERIC: Record<"tr" | "en", string[]> = {
  tr: ["Çalışma saatleriniz nedir?", "Fiyatlarınız nedir?", "Size nasıl ulaşabilirim?", "Bitcoin fiyatı ne olur?"],
  en: ["What are your opening hours?", "What are your prices?", "How can I contact you?", "Will bitcoin go up?"],
};

export default async function TrialPreview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getStore();
  const a = await store.getAssistant(id);
  if (!isActiveTrial(a)) notFound();

  const chunks = await store.getChunks(id);
  const lang = chunks.some((c) => c.lang === "tr") || chunks.length === 0 ? "tr" : "en";
  const fromKb = [...new Set(chunks.map((c) => suggestionText(c.heading)).filter((h) => /\?$/.test(h) && h.length <= 80))].slice(0, 4);
  // the knowledge base's own questions first, then a generic one, and one off-topic question to show it won't invent
  const suggestions = [...fromKb, ...GENERIC[lang].filter((q) => !fromKb.includes(q))].slice(0, 5);
  if (!suggestions.includes(GENERIC[lang][3])) suggestions.push(GENERIC[lang][3]);

  const expires = new Date(a.trial.expiresAt).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" });
  const host = /^https?:/.test(a.trial.source) ? new URL(a.trial.source).hostname : a.trial.source;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-slate-900 px-4 py-2 text-center text-xs text-slate-200">
        Deneme önizlemesi · bilgiler <b>{host}</b> kaynağından okundu · {expires} tarihinde silinecek ·{" "}
        <Link href="/try" className="underline">
          yeni deneme
        </Link>
      </div>

      <header style={{ background: a.color }} className="text-white">
        <div className="mx-auto max-w-5xl px-4 py-12">
          <p className="text-sm uppercase tracking-wide opacity-80">Sitenizin yerine bir önizleme</p>
          <h1 className="mt-2 text-4xl font-bold">{a.businessName}</h1>
          <p className="mt-3 max-w-xl text-lg opacity-90">
            Müşteri asistanınız hazır. Sağ alttaki pencereden soru sorun: fiyatlarınız, saatleriniz, koşullarınız… Bilmediği
            bir şeyi de sorun; uydurmadığını görün.
          </p>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 md:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <section className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
            <h2 className="font-semibold">Şunları sorun</h2>
            <p className="mt-1 text-sm text-slate-500">Tıklayın, asistan sorsun. Sonuncusu bilgi tabanında olmayan bir soru.</p>
            <div className="mt-3">
              <AskButtons questions={suggestions} color={a.color} />
            </div>
          </section>
          <section className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
            <h2 className="font-semibold">Asistan neyi okudu?</h2>
            <p className="mt-1 text-sm text-slate-500">
              {a.trial.pages.length} sayfa / belge, {chunks.length} bilgi parçası. Asistan yalnızca bunlardan cevap verir.
            </p>
            <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-slate-700">
              {a.trial.pages.map((p, i) => (
                <li key={`${p}-${i}`}>{p}</li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
            <h2 className="font-semibold">Bunu sitenize ekleyelim</h2>
            <p className="mt-1 text-sm text-slate-600">
              Tek satır kodla sitenize eklenir. Cevaplayamadığı sorularda müşterinin iletişim bilgisini alıp size iletir.
            </p>
            <div className="mt-3">
              <InterestForm id={a.id} />
            </div>
          </section>
          <p className="px-1 text-xs text-slate-500">
            Deneme asistanı, sitenizin herkese açık sayfalarından okunan bilgilerle çalışır. Sitede olmayan bilgileri (ör. kampanya
            ayrıntıları) belge olarak ekleyince cevapları da tamamlanır.
          </p>
        </aside>
      </main>

      <script src="/widget.js" data-assistant={a.id} data-lang={lang} data-open="true" async />
    </div>
  );
}
