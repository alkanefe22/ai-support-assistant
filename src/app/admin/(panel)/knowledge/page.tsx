import { adminAccess } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { getStore } from "@/lib/store";
import { addFaqText, deleteDocument, reindex, uploadDocument } from "../../actions";
import { currentAssistant } from "../../current";
import { btnCls, btnGhostCls, Card, Empty, Flash, fmtDate, inputCls, PageTitle, ReadOnlyHint } from "../../ui";

function LangSelect() {
  return (
    <select name="lang" defaultValue="tr" className={inputCls} aria-label="Dil">
      <option value="tr">Türkçe</option>
      <option value="en">English</option>
    </select>
  );
}

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const { assistant } = await currentAssistant();
  const ro = (await adminAccess()) === "readonly";
  const store = await getStore();
  const [docs, chunks] = await Promise.all([store.listDocuments(assistant.id), store.getChunks(assistant.id)]);
  const flaggedChunks = chunks.filter((c) => c.suspicious);
  const models = [...new Set(chunks.map((c) => c.embeddingModel))];

  return (
    <>
      <PageTitle
        title="Bilgi tabanı"
        subtitle="Asistan yalnızca buradaki içerikten cevap verir. Belgeler parçalara bölünür ve aranabilir hale getirilir."
      />
      <Flash ok={ok} error={error} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Dosya yükle</h2>
          <p className="mt-1 text-xs text-slate-500">PDF, TXT veya Markdown · en fazla 4 MB</p>
          <ReadOnlyHint show={ro} />
          <form action={uploadDocument} className="mt-3">
            <fieldset disabled={ro} className="space-y-3">
            <input type="file" name="file" accept=".pdf,.txt,.md,.markdown" required className="block w-full text-sm" />
            <input name="title" placeholder="Başlık (isteğe bağlı)" className={inputCls} maxLength={120} />
            <LangSelect />
            <button className={btnCls}>Yükle ve indeksle</button>
            </fieldset>
          </form>
        </Card>
        <Card>
          <h2 className="font-semibold">SSS metni yapıştır</h2>
          <p className="mt-1 text-xs text-slate-500">
            &quot;## Soru?&quot; başlıkları, &quot;S: … C: …&quot; veya soru satırı + cevap paragrafı biçimleri tanınır.
          </p>
          <ReadOnlyHint show={ro} />
          <form action={addFaqText} className="mt-3">
            <fieldset disabled={ro} className="space-y-3">
            <input name="title" placeholder="Başlık" className={inputCls} maxLength={120} />
            <textarea name="text" required rows={5} className={inputCls} placeholder={"S: Kargo ücretli mi?\nC: 500 TL üzeri siparişlerde ücretsiz."} />
            <LangSelect />
            <button className={btnCls}>Ekle</button>
            </fieldset>
          </form>
        </Card>
      </div>

      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Belgeler ({docs.length})</h2>
          <form action={reindex} className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              İndeks: {models.join(", ") || "—"} · aktif: {getConfig().embeddingProvider}
            </span>
            <button className={btnGhostCls} disabled={ro}>
              Yeniden indeksle
            </button>
          </form>
        </div>
        {docs.length === 0 ? (
          <div className="mt-4">
            <Empty>Henüz belge yok. Asistan bilgi tabanı olmadan her soruya &quot;bilmiyorum&quot; der.</Empty>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Başlık</th>
                  <th className="py-2 pr-3">Tür</th>
                  <th className="py-2 pr-3">Dil</th>
                  <th className="py-2 pr-3">Parça</th>
                  <th className="py-2 pr-3">Eklendi</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100">
                    <td className="py-2 pr-3 font-medium">
                      {d.title}
                      {d.flaggedChunks > 0 && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900" title="Talimat benzeri metin içeriyor">
                          ⚠ {d.flaggedChunks} şüpheli
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 uppercase text-slate-500">{d.sourceType}</td>
                    <td className="py-2 pr-3 uppercase text-slate-500">{d.lang}</td>
                    <td className="py-2 pr-3">{d.chunkCount}</td>
                    <td className="py-2 pr-3 text-slate-500">{fmtDate(d.createdAt)}</td>
                    <td className="py-2 text-right">
                      <form action={deleteDocument}>
                        <input type="hidden" name="id" value={d.id} />
                        <button disabled={ro} className="text-sm text-red-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline" aria-label={`${d.title} belgesini sil`}>
                          Sil
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {flaggedChunks.length > 0 && (
        <Card className="mt-6">
          <h2 className="font-semibold">Talimat benzeri içerik</h2>
          <p className="mt-1 text-sm text-slate-600">
            Bu parçalar &quot;önceki talimatları yok say&quot; gibi ifadeler içeriyor. Asistan bunları talimat olarak değil
            veri olarak görür ve uygulamaz; yine de belgeyi gözden geçirmeniz önerilir.
          </p>
          <ul className="mt-3 space-y-2">
            {flaggedChunks.slice(0, 10).map((c) => (
              <li key={c.id} className="rounded-md bg-amber-50 p-3 text-xs text-amber-950">
                <b>{c.title}</b> — {c.text.slice(0, 240)}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
