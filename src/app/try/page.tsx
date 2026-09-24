import type { Metadata } from "next";
import Link from "next/link";
import { getConfig } from "@/lib/config";
import { TryForm } from "./TryForm";

export const metadata: Metadata = {
  title: "Kendi sitenizle deneyin — AI Support Assistant",
  description: "Web sitenizin adresini yazın, 1 dakikada sizin bilgilerinizle cevap veren destek asistanını görün.",
};

export const dynamic = "force-dynamic";

const POINTS = [
  ["Sizin bilgilerinizle", "Fiyatlarınızı, çalışma saatlerinizi, iade koşullarınızı sitenizden öğrenir."],
  ["Uydurmaz", "Bilmediği soruda \"bilmiyorum\" der ve müşteriyi size yönlendirir; her cevabın kaynağını gösterir."],
  ["Müşteri kaçırmaz", "Cevaplayamadığı soruda iletişim bilgisini alır, size lead olarak iletir."],
];

export default function TryPage() {
  const { provider } = getConfig();
  return (
    <main className="min-h-screen bg-gradient-to-b from-teal-50 to-slate-50">
      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 md:grid-cols-[1fr_420px] md:py-20">
        <section>
          <Link href="/" className="text-sm font-semibold text-teal-800">
            ← AI Support Assistant
          </Link>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">Kendi sitenizle 1 dakikada deneyin</h1>
          <p className="mt-4 text-lg text-slate-600">
            Site adresinizi yazın. Asistan sitenizi okur ve müşterilerinizin sorularını <b>sizin bilgilerinizle</b> cevaplamaya başlar.
            Kendi fiyatınızı sorun, bilmediği bir şeyi sorun; farkı görün.
          </p>
          <ul className="mt-8 space-y-4">
            {POINTS.map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-teal-700 text-sm text-white" aria-hidden>
                  ✓
                </span>
                <span>
                  <b className="text-slate-900">{t}.</b> <span className="text-slate-600">{d}</span>
                </span>
              </li>
            ))}
          </ul>
          {provider === "demo" && (
            <p className="mt-8 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
              Bu sunucu yapay zekâsız demo modunda: cevaplar bilgi tabanından olduğu gibi alıntılanır, eşanlamlılar anlaşılmaz.
              Gerçek deneyim için yapay zekâ sağlayıcısı (Gemini / Claude / Ollama) açık olmalıdır.
            </p>
          )}
        </section>
        <section>
          <TryForm />
          <p className="mt-3 text-center text-xs text-slate-500">Ücretsiz · kayıt gerekmez · 24 saat sonra otomatik silinir</p>
        </section>
      </div>
    </main>
  );
}
