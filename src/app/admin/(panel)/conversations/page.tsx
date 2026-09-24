import { adminAccess } from "@/lib/auth";
import { redactPII } from "@/lib/privacy";
import { getStore } from "@/lib/store";
import { currentAssistant } from "../../current";
import { Card, Empty, fmtDate, PageTitle } from "../../ui";

export default async function ConversationsPage() {
  const { assistant } = await currentAssistant();
  const ro = (await adminAccess()) === "readonly";
  const show = (t: string) => (ro ? redactPII(t) : t);
  const conversations = await (await getStore()).listConversations(assistant.id, 100);

  return (
    <>
      <PageTitle title="Sohbet geçmişi" subtitle="Son 100 sohbet. Kaynaklar ve cevaplanamayan mesajlar işaretlidir." />
      {conversations.length === 0 ? (
        <Empty>Henüz sohbet yok. Demo sitesinden asistana birkaç soru sorun.</Empty>
      ) : (
        <div className="space-y-3">
          {conversations.map((c) => {
            const first = c.messages.find((m) => m.role === "user");
            const misses = c.messages.filter((m) => m.role === "assistant" && m.answered === false).length;
            return (
              <Card key={c.id} className="!p-0">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4">
                    <span className="min-w-0 flex-1 truncate font-medium">{first ? show(first.text) : "—"}</span>
                    <span className="text-xs uppercase text-slate-500">{c.lang}</span>
                    <span className="text-xs text-slate-500">{c.messages.length} mesaj</span>
                    {misses > 0 && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">{misses} cevapsız</span>
                    )}
                    <span className="text-xs text-slate-500">{fmtDate(c.updatedAt)}</span>
                  </summary>
                  <ol className="space-y-2 border-t border-slate-100 px-5 py-4">
                    {c.messages.map((m) => (
                      <li key={m.id} className={m.role === "user" ? "text-right" : ""}>
                        <div
                          className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-left text-sm ${
                            m.role === "user"
                              ? "bg-teal-700 text-white"
                              : m.answered === false
                                ? "bg-amber-50 ring-1 ring-amber-200"
                                : "bg-slate-100"
                          }`}
                        >
                          {show(m.text)}
                          {m.sources && m.sources.length > 0 && (
                            <div className="mt-1 text-xs text-slate-500">
                              Kaynak: {m.sources.map((s) => `${s.heading} (${s.score})`).join(" · ")}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </details>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
