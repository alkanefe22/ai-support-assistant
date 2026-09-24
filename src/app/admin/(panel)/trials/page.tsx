import Link from "next/link";
import { adminAccess } from "@/lib/auth";
import { maskContact, maskName } from "@/lib/privacy";
import { getStore } from "@/lib/store";
import { Card, Empty, fmtDate, PageTitle } from "../../ui";

/**
 * Sales view: who tried the product with their own site, how much they used it,
 * and who asked to have it on their site ("Bunu sitemde istiyorum").
 */
export default async function TrialsPage() {
  const ro = (await adminAccess()) === "readonly";
  const store = await getStore();
  const trials = (await store.listAssistants()).filter((a) => a.trial).sort((a, b) => b.trial!.createdAt.localeCompare(a.trial!.createdAt));
  const rows = await Promise.all(
    trials.map(async (a) => {
      const [conversations, leads, unanswered] = await Promise.all([
        store.listConversations(a.id, 500),
        store.listLeads(a.id),
        store.listUnanswered(a.id),
      ]);
      const questions = conversations.reduce((n, c) => n + c.messages.filter((m) => m.role === "user").length, 0);
      return { a, questions, leads, unanswered: unanswered.length };
    }),
  );
  const interested = rows.filter((r) => r.a.trial!.interested);

  return (
    <>
      <PageTitle
        title="Denemeler"
        subtitle={'"Kendi sitenizle deneyin" ile oluşturulan geçici asistanlar. 24 saat sonra (ilgilenenlerde 7 gün sonra) otomatik silinir.'}
      />
      <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          ["Deneme", rows.length],
          ["Sorulan soru", rows.reduce((n, r) => n + r.questions, 0)],
          ["\"Sitemde istiyorum\"", interested.length],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <div className="text-xs text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-bold">{value}</div>
          </div>
        ))}
      </div>

      <Card>
        {rows.length === 0 ? (
          <Empty>
            Henüz deneme yok. <Link href="/try" className="underline">/try</Link> sayfasını paylaşın.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-3">İşletme / kaynak</th>
                  <th className="py-2 pr-3">Sayfa</th>
                  <th className="py-2 pr-3">Soru</th>
                  <th className="py-2 pr-3">Cevapsız</th>
                  <th className="py-2 pr-3">İlgilenen</th>
                  <th className="py-2 pr-3">Oluşturuldu</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ a, questions, leads, unanswered }) => (
                  <tr key={a.id} className="border-t border-slate-100 align-top">
                    <td className="py-2 pr-3">
                      <Link href={`/try/${a.id}`} className="font-medium hover:underline">
                        {a.businessName}
                      </Link>
                      <div className="text-xs text-slate-500">{a.trial!.source}</div>
                    </td>
                    <td className="py-2 pr-3">{a.trial!.pages.length}</td>
                    <td className="py-2 pr-3">{questions}</td>
                    <td className="py-2 pr-3">{unanswered}</td>
                    <td className="py-2 pr-3">
                      {leads.length === 0
                        ? "—"
                        : leads.map((l) => (
                            <div key={l.id} className="text-xs">
                              <b>{ro ? maskName(l.name) : l.name}</b> · {ro ? maskContact(l.contact) : l.contact}
                            </div>
                          ))}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-slate-500">{fmtDate(a.trial!.createdAt)}</td>
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
