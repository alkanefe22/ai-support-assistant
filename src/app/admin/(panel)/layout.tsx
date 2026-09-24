import Link from "next/link";
import { adminAccess, authMode, requireAdmin } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { logout, selectAssistant } from "../actions";
import { currentAssistant } from "../current";

export const dynamic = "force-dynamic";

const NAV = [
  ["/admin", "Genel bakış"],
  ["/admin/knowledge", "Bilgi tabanı"],
  ["/admin/settings", "Asistan ayarları"],
  ["/admin/conversations", "Sohbet geçmişi"],
  ["/admin/unanswered", "Cevaplanamayanlar"],
  ["/admin/leads", "Leadler"],
  ["/admin/trials", "Denemeler"],
] as const;

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const { assistant, all } = await currentAssistant();
  const { provider, embeddingProvider } = getConfig();
  const mode = authMode();
  const access = await adminAccess();

  return (
    <div className="min-h-screen">
      {access === "readonly" ? (
        <div role="status" className="bg-sky-100 px-4 py-2 text-center text-xs text-sky-900">
          🔒 <b>Salt okunur demo.</b> Paneli serbestçe gezebilirsiniz; belge yükleme, silme ve ayar değiştirme kapalı.
          Ziyaretçi iletişim bilgileri maskelenir.
          {mode === "password" && (
            <>
              {" "}
              <Link href="/admin/login" className="underline">
                Yönetici girişi
              </Link>
            </>
          )}
        </div>
      ) : mode === "open-demo" && (
        <div className="bg-amber-100 px-4 py-2 text-center text-xs text-amber-900">
          Demo modu: <code>ADMIN_PASSWORD</code> tanımlı olmadığı için panel şifresiz açık. Canlıya almadan önce şifre belirleyin.
        </div>
      )}
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="md:w-60 md:shrink-0">
          <Link href="/" className="block text-lg font-bold">
            AI Support Assistant
          </Link>
          <div className="mt-1 text-xs text-slate-500">
            LLM: <b>{provider}</b> · Embedding: <b>{embeddingProvider}</b>
          </div>

          <form action={selectAssistant} className="mt-4">
            <label className="text-xs font-medium text-slate-500" htmlFor="assistantId">
              Asistan
            </label>
            <div className="mt-1 flex gap-2">
              <select
                id="assistantId"
                name="assistantId"
                defaultValue={assistant.id}
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                {all.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.businessName}
                  </option>
                ))}
              </select>
              <button className="rounded-md bg-slate-200 px-2 text-sm hover:bg-slate-300">Seç</button>
            </div>
          </form>

          <nav className="mt-4 flex gap-1 overflow-x-auto md:flex-col" aria-label="Panel">
            {NAV.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-white hover:ring-1 hover:ring-slate-200"
              >
                {label}
              </Link>
            ))}
          </nav>
          {mode === "password" && access === "full" && (
            <form action={logout} className="mt-4">
              <button className="text-sm text-slate-500 underline">Çıkış yap</button>
            </form>
          )}
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
