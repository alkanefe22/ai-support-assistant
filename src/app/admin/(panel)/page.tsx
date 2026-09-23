import Link from "next/link";
import { headers } from "next/headers";
import { getStore } from "@/lib/store";
import { currentAssistant } from "../current";
import { Card, PageTitle } from "../ui";

export default async function Overview() {
  const { assistant } = await currentAssistant();
  const store = await getStore();
  const [docs, conversations, unanswered, leads] = await Promise.all([
    store.listDocuments(assistant.id),
    store.listConversations(assistant.id, 2000),
    store.listUnanswered(assistant.id),
    store.listLeads(assistant.id),
  ]);
  const answers = conversations.flatMap((c) => c.messages.filter((m) => m.role === "assistant"));
  const answeredRate = answers.length ? Math.round((answers.filter((m) => m.answered).length / answers.length) * 100) : 0;
  const openUnanswered = unanswered.filter((q) => !q.resolved).length;
  const flagged = docs.reduce((s, d) => s + d.flaggedChunks, 0);

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const snippet = `<script src="${origin}/widget.js" data-assistant="${assistant.id}" async></script>`;

  const stats = [
    ["Belge", docs.length, "/admin/knowledge"],
    ["Parça (chunk)", docs.reduce((s, d) => s + d.chunkCount, 0), "/admin/knowledge"],
    ["Sohbet", conversations.length, "/admin/conversations"],
    ["Cevaplanma oranı", `%${answeredRate}`, "/admin/conversations"],
    ["Açık eksik bilgi", openUnanswered, "/admin/unanswered"],
    ["Lead", leads.length, "/admin/leads"],
  ] as const;

  return (
    <>
      <PageTitle title={assistant.businessName} subtitle={`Asistan: ${assistant.name} · ID: ${assistant.id}`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {stats.map(([label, value, href]) => (
          <Link key={label} href={href} className="rounded-xl bg-white p-4 ring-1 ring-slate-200 hover:ring-teal-400">
            <div className="text-xs text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-bold">{value}</div>
          </Link>
        ))}
      </div>
      {flagged > 0 && (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          {flagged} parça talimat benzeri metin içeriyor. Bu metinler modele yalnızca veri olarak verilir; yine de{" "}
          <Link href="/admin/knowledge" className="underline">
            bilgi tabanını
          </Link>{" "}
          kontrol edin.
        </p>
      )}
      <Card className="mt-6">
        <h2 className="font-semibold">Sitenize ekleyin</h2>
        <p className="mt-1 text-sm text-slate-600">Bu satırı sitenizin &lt;body&gt; kapanışından önce yapıştırın.</p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-teal-100">
          <code>{snippet}</code>
        </pre>
        <p className="mt-2 text-xs text-slate-500">
          İsteğe bağlı: <code>data-lang=&quot;en&quot;</code>, <code>data-position=&quot;left&quot;</code>
        </p>
      </Card>
    </>
  );
}
