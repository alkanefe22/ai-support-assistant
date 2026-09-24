import { adminAccess } from "@/lib/auth";
import { maskContact, maskName, redactPII } from "@/lib/privacy";
import { getStore } from "@/lib/store";
import { deleteLead } from "../../actions";
import { currentAssistant } from "../../current";
import { btnGhostCls, Card, Empty, Flash, fmtDate, PageTitle, ReadOnlyHint } from "../../ui";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { assistant } = await currentAssistant();
  const ro = (await adminAccess()) === "readonly";
  const leads = await (await getStore()).listLeads(assistant.id);

  return (
    <>
      <PageTitle
        title="Leadler"
        subtitle="Asistanın cevap veremediği durumlarda, onay vererek iletişim bilgisini bırakan ziyaretçiler."
      />
      <Flash error={error} />
      <Card>
        <ReadOnlyHint show={ro} />
        {ro ? (
          <p className="mb-3 text-xs text-slate-500">
            Ziyaretçi gizliliği için ad ve iletişim bilgileri maskelenmiştir; CSV dışa aktarma kapalı.
          </p>
        ) : (
          <div className="mb-3 flex justify-end">
            <a href="/admin/leads/export" className={btnGhostCls}>
              CSV indir
            </a>
          </div>
        )}
        {leads.length === 0 ? (
          <Empty>Henüz lead yok.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Ad</th>
                  <th className="py-2 pr-3">İletişim</th>
                  <th className="py-2 pr-3">Soru</th>
                  <th className="py-2 pr-3">Tarih</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100 align-top">
                    <td className="py-2 pr-3 font-medium">{ro ? maskName(l.name) : l.name}</td>
                    <td className="py-2 pr-3">{ro ? maskContact(l.contact) : l.contact}</td>
                    <td className="py-2 pr-3 text-slate-600">{ro ? redactPII(l.question) : l.question}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-slate-500">{fmtDate(l.createdAt)}</td>
                    <td className="py-2 text-right">
                      <form action={deleteLead}>
                        <input type="hidden" name="id" value={l.id} />
                        <button
                          disabled={ro}
                          className="text-sm text-red-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
                        >
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
    </>
  );
}
