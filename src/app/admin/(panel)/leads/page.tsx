import { getStore } from "@/lib/store";
import { deleteLead } from "../../actions";
import { currentAssistant } from "../../current";
import { btnGhostCls, Card, Empty, fmtDate, PageTitle } from "../../ui";

export default async function LeadsPage() {
  const { assistant } = await currentAssistant();
  const leads = await (await getStore()).listLeads(assistant.id);

  return (
    <>
      <PageTitle
        title="Leadler"
        subtitle="Asistanın cevap veremediği durumlarda, onay vererek iletişim bilgisini bırakan ziyaretçiler."
      />
      <Card>
        <div className="mb-3 flex justify-end">
          <a href="/admin/leads/export" className={btnGhostCls}>
            CSV indir
          </a>
        </div>
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
                    <td className="py-2 pr-3 font-medium">{l.name}</td>
                    <td className="py-2 pr-3">{l.contact}</td>
                    <td className="py-2 pr-3 text-slate-600">{l.question}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-slate-500">{fmtDate(l.createdAt)}</td>
                    <td className="py-2 text-right">
                      <form action={deleteLead}>
                        <input type="hidden" name="id" value={l.id} />
                        <button className="text-sm text-red-700 hover:underline">Sil</button>
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
