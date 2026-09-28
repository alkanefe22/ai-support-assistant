import Link from "next/link";
import { getConfig } from "@/lib/config";
import { DEMO_ASSISTANT_ID } from "@/lib/seed";
import { trialConfig } from "@/lib/try/trial";

export const dynamic = "force-dynamic";

const FEATURES = [
  ["Bilgi tabanı", "PDF, TXT, Markdown veya SSS metni yükleyin; parçalanır, gömülür ve aranabilir hale gelir."],
  ["Kaynaklı cevap", "Asistan yalnızca bilgi tabanından cevap verir ve her cevapta kullandığı parçayı gösterir."],
  ["Uydurmaz", "Bilgi yoksa \"bilmiyorum\" der, ziyaretçiyi yetkiliye yönlendirir ve iletişim bilgisini lead olarak kaydeder."],
  ["Tek satır kurulum", "Shadow DOM içinde çalışan, ~4 KB (gzip) widget. Sitenizin stilini bozmaz, mobil uyumlu."],
  ["Eksik bilgi raporu", "Cevaplanamayan sorular panelde listelenir; işletme hangi bilgiyi eklemesi gerektiğini görür."],
  ["Maliyet kontrolü", "Demo modu ücretsiz. Canlı modda rate limit, günlük limit ve istek başı token sınırı."],
];

export default function Home() {
  const { provider } = getConfig();
  const tryEnabled = trialConfig().enabled;
  const snippet = `<script src="https://YOUR-DOMAIN/widget.js" data-assistant="${DEMO_ASSISTANT_ID}" async></script>`;
  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:py-20">
      <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800 ring-1 ring-teal-200">
        <span className="h-2 w-2 rounded-full bg-teal-500" />
        Mod: {provider === "demo" ? "Demo (API anahtarı yok, maliyet yok)" : `Canlı — ${provider}`}
      </div>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">AI Support Assistant</h1>
      <p className="mt-4 max-w-2xl text-lg text-slate-600">
        İşletmenizin dokümanlarından bilgi tabanı oluşturan, sitenize tek satırla eklenen ve yalnızca
        bildiği konularda, kaynak göstererek cevap veren destek asistanı.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        {tryEnabled && (
          <Link href="/try" className="rounded-lg bg-teal-700 px-5 py-3 font-semibold text-white hover:bg-teal-800">
            Kendi sitenizle deneyin →
          </Link>
        )}
        <a
          href="/demo"
          className={
            tryEnabled
              ? "rounded-lg bg-white px-5 py-3 font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50"
              : "rounded-lg bg-teal-700 px-5 py-3 font-semibold text-white hover:bg-teal-800"
          }
        >
          Demo siteyi aç (TR)
        </a>
        <a href="/demo?lang=en" className="rounded-lg bg-white px-5 py-3 font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50">
          Demo (EN)
        </a>
        <Link href="/admin" className="rounded-lg bg-white px-5 py-3 font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50">
          Yönetim paneli
        </Link>
      </div>

      <section className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(([title, body]) => (
          <div key={title} className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-slate-600">{body}</p>
          </div>
        ))}
      </section>

      <section className="mt-14">
        <h2 className="text-lg font-semibold">Kurulum</h2>
        <p className="mt-1 text-sm text-slate-600">Sitenizin &lt;body&gt; kapanışından önce ekleyin:</p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-teal-100">
          <code>{snippet}</code>
        </pre>
      </section>
    </main>
  );
}
