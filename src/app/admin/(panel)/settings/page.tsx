import { createAssistant, saveSettings } from "../../actions";
import { currentAssistant } from "../../current";
import { btnCls, Card, Flash, inputCls, PageTitle } from "../../ui";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const { assistant: a } = await currentAssistant();

  return (
    <>
      <PageTitle title="Asistan ayarları" subtitle="Widget'ta görünen ad, renk ve karşılama mesajı." />
      <Flash ok={ok} error={error} />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card>
          <form action={saveSettings} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Asistan adı">
                <input name="name" defaultValue={a.name} maxLength={60} className={inputCls} required />
              </Field>
              <Field label="İşletme adı">
                <input name="businessName" defaultValue={a.businessName} maxLength={80} className={inputCls} required />
              </Field>
            </div>
            <Field label="Tema rengi">
              <input type="color" name="color" defaultValue={a.color} className="h-10 w-20 rounded border border-slate-300" />
            </Field>
            <Field label="Karşılama mesajı (TR)">
              <textarea name="welcomeTr" defaultValue={a.welcome.tr} rows={2} maxLength={400} className={inputCls} />
            </Field>
            <Field label="Karşılama mesajı (EN)">
              <textarea name="welcomeEn" defaultValue={a.welcome.en} rows={2} maxLength={400} className={inputCls} />
            </Field>
            <Field
              label="İzin verilen siteler"
              hint="Her satıra bir adres (örn. https://www.ornek.com). Boş bırakılırsa widget her sitede çalışır."
            >
              <textarea name="allowedOrigins" defaultValue={a.allowedOrigins.join("\n")} rows={3} className={inputCls} />
            </Field>
            <button className={btnCls}>Kaydet</button>
          </form>
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="font-semibold">Önizleme</h2>
            <div className="mt-3 overflow-hidden rounded-xl ring-1 ring-slate-200">
              <div className="px-4 py-3 text-white" style={{ background: a.color }}>
                <div className="font-semibold">{a.name}</div>
                <div className="text-xs opacity-85">{a.businessName}</div>
              </div>
              <div className="bg-slate-50 p-3">
                <div className="rounded-xl bg-white p-3 text-sm ring-1 ring-slate-200">{a.welcome.tr}</div>
              </div>
            </div>
          </Card>
          <Card>
            <h2 className="font-semibold">Yeni asistan</h2>
            <p className="mt-1 text-xs text-slate-500">Başka bir işletme için ayrı bilgi tabanı ve widget.</p>
            <form action={createAssistant} className="mt-3 space-y-3">
              <input name="businessName" placeholder="İşletme adı" maxLength={80} className={inputCls} required />
              <button className={btnCls}>Oluştur</button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
