import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { getConfig } from "@/lib/config";
import { DEMO_ASSISTANT_ID } from "@/lib/seed";
import { siteUrl } from "@/lib/site";
import { trialConfig } from "@/lib/try/trial";

export const dynamic = "force-dynamic";

type Lang = "en" | "tr";

const COPY: Record<
  Lang,
  {
    mode: (provider: string) => string;
    lead: string;
    tryIt: string;
    demo: string;
    admin: string;
    features: [string, string][];
    setup: string;
    setupHint: string;
  }
> = {
  en: {
    mode: (p) => (p === "demo" ? "Mode: Demo (no API key, no cost)" : `Mode: Live — ${p}`),
    lead: "A support assistant that builds a knowledge base from your business documents, goes on your site with one line of code, and only answers what it knows, citing the source.",
    tryIt: "Try it with your own site →",
    demo: "Open the demo site",
    admin: "Admin panel",
    features: [
      ["Knowledge base", "Upload PDF, TXT or Markdown files, or paste an FAQ; it is chunked, embedded and made searchable."],
      ["Answers with sources", "The assistant answers only from your knowledge base and shows the passage it used for every answer."],
      ["Doesn't make things up", "When the answer isn't there it says so, hands the visitor over to your team and saves their contact details as a lead."],
      ["One-line install", "A ~4 KB (gzip) widget inside Shadow DOM. It won't break your site's styles and works on mobile."],
      ["Missing-info report", "Unanswered questions are listed in the panel, so you see exactly which information to add."],
      ["Cost control", "Demo mode is free. In live mode: rate limits, a daily limit and a token cap per request."],
    ],
    setup: "Install",
    setupHint: "Add this before the closing </body> tag of your site:",
  },
  tr: {
    mode: (p) => (p === "demo" ? "Mod: Demo (API anahtarı yok, maliyet yok)" : `Mod: Canlı — ${p}`),
    lead: "İşletmenizin dokümanlarından bilgi tabanı oluşturan, sitenize tek satırla eklenen ve yalnızca bildiği konularda, kaynak göstererek cevap veren destek asistanı.",
    tryIt: "Kendi sitenizle deneyin →",
    demo: "Demo siteyi aç",
    admin: "Yönetim paneli",
    features: [
      ["Bilgi tabanı", "PDF, TXT, Markdown veya SSS metni yükleyin; parçalanır, gömülür ve aranabilir hale gelir."],
      ["Kaynaklı cevap", "Asistan yalnızca bilgi tabanından cevap verir ve her cevapta kullandığı parçayı gösterir."],
      ["Uydurmaz", "Bilgi yoksa \"bilmiyorum\" der, ziyaretçiyi yetkiliye yönlendirir ve iletişim bilgisini lead olarak kaydeder."],
      ["Tek satır kurulum", "Shadow DOM içinde çalışan, ~4 KB (gzip) widget. Sitenizin stilini bozmaz, mobil uyumlu."],
      ["Eksik bilgi raporu", "Cevaplanamayan sorular panelde listelenir; işletme hangi bilgiyi eklemesi gerektiğini görür."],
      ["Maliyet kontrolü", "Demo modu ücretsiz. Canlı modda rate limit, günlük limit ve istek başı token sınırı."],
    ],
    setup: "Kurulum",
    setupHint: "Sitenizin </body> kapanışından önce ekleyin:",
  },
};

const pickLang = (v?: string): Lang => (v === "tr" ? "tr" : "en");

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ lang?: string }> }): Promise<Metadata> {
  const lang = pickLang((await searchParams).lang);
  return lang === "tr"
    ? {
        title: "AI Support Assistant — kaynak gösteren destek asistanı",
        description: "Dokümanlarınızı yükleyin, tek satır kod ekleyin; yalnızca bilgi tabanınızdan cevap veren bir destek asistanı.",
      }
    : {
        title: "AI Support Assistant — a support assistant that cites its sources",
        description: "Upload your documents, embed one script tag, and get a support assistant that only answers from your knowledge base.",
      };
}

export default async function Home({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang = pickLang((await searchParams).lang);
  const t = COPY[lang];
  const { provider } = getConfig();
  const tryEnabled = trialConfig().enabled;
  const h = await headers();
  const base = siteUrl(h.get("x-forwarded-host") ?? h.get("host"));
  const snippet = `<script src="${base}/widget.js" data-assistant="${DEMO_ASSISTANT_ID}" data-lang="${lang}" async></script>`;
  // English landing → English demo; Turkish landing → Turkish demo
  const demoHref = lang === "en" ? "/demo?lang=en" : "/demo";
  const primary = "rounded-lg bg-teal-700 px-5 py-3 font-semibold text-white hover:bg-teal-800";
  const secondary = "rounded-lg bg-white px-5 py-3 font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50";

  return (
    <main lang={lang} className="mx-auto max-w-5xl px-4 py-12 sm:py-20">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800 ring-1 ring-teal-200">
          <span className="h-2 w-2 rounded-full bg-teal-500" />
          {t.mode(provider)}
        </div>
        <nav aria-label={lang === "en" ? "Language" : "Dil"} className="flex overflow-hidden rounded-md text-sm font-medium ring-1 ring-teal-200">
          {(["en", "tr"] as const).map((l) => (
            <Link
              key={l}
              href={l === "en" ? "/" : "/?lang=tr"}
              hrefLang={l}
              aria-current={l === lang ? "page" : undefined}
              className={l === lang ? "bg-teal-700 px-3 py-1.5 text-white" : "px-3 py-1.5 text-teal-700 hover:bg-teal-50"}
            >
              {l.toUpperCase()}
            </Link>
          ))}
        </nav>
      </div>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">AI Support Assistant</h1>
      <p className="mt-4 max-w-2xl text-lg text-slate-600">{t.lead}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        {tryEnabled && (
          <Link href="/try" className={primary}>
            {t.tryIt}
          </Link>
        )}
        <a href={demoHref} className={tryEnabled ? secondary : primary}>
          {t.demo}
        </a>
        <Link href="/admin" className={secondary}>
          {t.admin}
        </Link>
      </div>

      <section className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {t.features.map(([title, body]) => (
          <div key={title} className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-slate-600">{body}</p>
          </div>
        ))}
      </section>

      <section className="mt-14">
        <h2 className="text-lg font-semibold">{t.setup}</h2>
        <p className="mt-1 text-sm text-slate-600">{t.setupHint}</p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-teal-100">
          <code>{snippet}</code>
        </pre>
      </section>
    </main>
  );
}
