import type { Metadata } from "next";
import { DEMO_ASSISTANT_ID } from "@/lib/seed";

export const metadata: Metadata = {
  title: "Gülümse Diş Kliniği — Demo",
  robots: { index: false },
};

const COPY = {
  tr: {
    banner: "Bu kurgusal bir demo sitesidir. Sağ alttaki asistan yalnızca kliniğin bilgi tabanından cevap verir.",
    nav: ["Tedaviler", "Fiyatlar", "İletişim"],
    switchLabel: "English",
    heroTitle: "Sağlıklı ve rahat bir gülüş için",
    heroText: "Kadıköy'de, deneyimli hekimlerimizle muayeneden implanta kadar tüm diş tedavileri. İlk muayene ücretsiz.",
    cta: "Asistana sorun",
    servicesTitle: "Tedavilerimiz",
    services: [
      ["Diş beyazlatma", "Tek seansta ofis tipi beyazlatma, 6.500 TL"],
      ["İmplant", "Ömür boyu üretici garantili, 22.000 TL'den başlayan fiyatlarla"],
      ["Şeffaf plak", "Ücretsiz ortodontik değerlendirme"],
      ["Çocuk diş hekimliği", "3 yaş ve üzeri çocuklar için"],
    ],
    hoursTitle: "Çalışma saatleri",
    hours: ["Hafta içi 09:00 – 19:00", "Cumartesi 10:00 – 16:00", "Pazar kapalı"],
    askTitle: "Asistana şunları sorabilirsiniz",
    asks: ["Diş beyazlatma ne kadar?", "Pazar günü açık mısınız?", "Taksit yapıyor musunuz?", "Göz muayenesi yapıyor musunuz? (bilgi yok → yönlendirme)"],
    footer: "Gülümse Diş Kliniği kurgusal bir işletmedir. Adres ve fiyatlar örnektir.",
  },
  en: {
    banner: "This is a fictional demo site. The assistant (bottom right) answers only from the clinic's knowledge base.",
    nav: ["Treatments", "Prices", "Contact"],
    switchLabel: "Türkçe",
    heroTitle: "For a healthy, confident smile",
    heroText: "All dental treatments from check-ups to implants, with experienced dentists in Kadıköy. First examination is free.",
    cta: "Ask the assistant",
    servicesTitle: "Our treatments",
    services: [
      ["Teeth whitening", "Single-session in-office whitening, 6,500 TL"],
      ["Implants", "Lifetime manufacturer warranty, from 22,000 TL"],
      ["Clear aligners", "Free orthodontic assessment"],
      ["Pediatric dentistry", "For children aged 3 and over"],
    ],
    hoursTitle: "Opening hours",
    hours: ["Weekdays 09:00 – 19:00", "Saturday 10:00 – 16:00", "Closed on Sunday"],
    askTitle: "Things you can ask the assistant",
    asks: ["How much is teeth whitening?", "Are you open on Sunday?", "Can I pay in installments?", "Do you do eye exams? (not in KB → hand-off)"],
    footer: "Gülümse Dental Clinic is a fictional business. Address and prices are examples.",
  },
};

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang = (await searchParams).lang === "en" ? "en" : "tr";
  const t = COPY[lang];
  return (
    <div lang={lang} className="min-h-screen bg-white">
      <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">{t.banner}</div>
      <header className="border-b border-slate-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-teal-600 text-lg text-white" aria-hidden>
              ☺
            </span>
            <span className="text-lg font-bold text-slate-900">
              Gülümse <span className="font-normal text-slate-500">{lang === "tr" ? "Diş Kliniği" : "Dental Clinic"}</span>
            </span>
          </div>
          <nav className="flex items-center gap-5 text-sm text-slate-600">
            {t.nav.map((n) => (
              <span key={n} className="hidden sm:inline">
                {n}
              </span>
            ))}
            <a href={lang === "tr" ? "/demo?lang=en" : "/demo"} className="rounded-md px-3 py-1.5 font-medium text-teal-700 ring-1 ring-teal-200 hover:bg-teal-50">
              {t.switchLabel}
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="bg-gradient-to-br from-teal-50 to-white">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
            <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">{t.heroTitle}</h1>
            <p className="mt-4 max-w-xl text-lg text-slate-600">{t.heroText}</p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-bold text-slate-900">{t.servicesTitle}</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.services.map(([title, body]) => (
              <div key={title} className="rounded-xl border border-slate-200 p-5">
                <h3 className="font-semibold text-slate-900">{title}</h3>
                <p className="mt-1 text-sm text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-8 px-4 pb-20 md:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-6">
            <h2 className="text-xl font-bold text-slate-900">{t.hoursTitle}</h2>
            <ul className="mt-3 space-y-1 text-slate-700">
              {t.hours.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl bg-teal-700 p-6 text-white">
            <h2 className="text-xl font-bold">{t.askTitle}</h2>
            <ul className="mt-3 list-inside list-disc space-y-1 text-teal-50">
              {t.asks.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-100 py-8 text-center text-sm text-slate-500">{t.footer}</footer>

      {/* The one-line embed a customer would paste into their site: */}
      <script src="/widget.js" data-assistant={DEMO_ASSISTANT_ID} data-lang={lang} async />
    </div>
  );
}
