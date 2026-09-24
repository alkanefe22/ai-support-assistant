import Link from "next/link";
import { adminAccess } from "@/lib/auth";
import { redactPII } from "@/lib/privacy";
import { normalize } from "@/lib/rag/text";
import { getStore } from "@/lib/store";
import type { UnansweredQuestion } from "@/lib/types";
import { setUnansweredResolved } from "../../actions";
import { currentAssistant } from "../../current";
import { btnGhostCls, Card, Empty, Flash, fmtDate, PageTitle, ReadOnlyHint } from "../../ui";

const REASON: Record<UnansweredQuestion["reason"], string> = {
  no_match: "Bilgi tabanında yok",
  model_declined: "Model yeterli bilgi bulamadı",
  error: "Sağlayıcı hatası",
};

interface Group {
  key: string;
  question: string;
  items: UnansweredQuestion[];
}

function group(list: UnansweredQuestion[]): Group[] {
  const map = new Map<string, Group>();
  for (const q of list) {
    const key = normalize(q.question).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    const g = map.get(key) ?? { key, question: q.question, items: [] };
    g.items.push(q);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.items.length - a.items.length);
}

function Row({ g, resolved, ro }: { g: Group; resolved: boolean; ro: boolean }) {
  const latest = g.items[0];
  return (
    <li className="flex flex-wrap items-center gap-3 border-t border-slate-100 py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className={`font-medium ${resolved ? "text-slate-400 line-through" : ""}`}>{ro ? redactPII(g.question) : g.question}</div>
        <div className="text-xs text-slate-500">
          {REASON[latest.reason]} · {latest.lang.toUpperCase()} · son: {fmtDate(latest.createdAt)}
        </div>
      </div>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold" title="Kaç kez soruldu">
        ×{g.items.length}
      </span>
      <form action={setUnansweredResolved}>
        <input type="hidden" name="ids" value={g.items.map((i) => i.id).join(",")} />
        <input type="hidden" name="resolved" value={resolved ? "0" : "1"} />
        <button className={btnGhostCls} disabled={ro}>{resolved ? "Geri al" : "Eklendi olarak işaretle"}</button>
      </form>
    </li>
  );
}

export default async function UnansweredPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { assistant } = await currentAssistant();
  const ro = (await adminAccess()) === "readonly";
  const list = await (await getStore()).listUnanswered(assistant.id);
  const open = group(list.filter((q) => !q.resolved));
  const done = group(list.filter((q) => q.resolved));

  return (
    <>
      <PageTitle
        title="Cevaplanamayan sorular"
        subtitle="Ziyaretçilerin sorduğu ama bilgi tabanında cevabı olmayan sorular. En çok sorulanlar üstte."
      />
      <Flash error={error} />
      <Card>
        <ReadOnlyHint show={ro} />
        {open.length === 0 ? (
          <Empty>Açık soru yok. 🎉</Empty>
        ) : (
          <ul>
            {open.map((g) => (
              <Row key={g.key} g={g} resolved={false} ro={ro} />
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-slate-500">
          İpucu: eksik bilgiyi <Link href="/admin/knowledge" className="underline">bilgi tabanına</Link> SSS olarak ekleyin,
          ardından soruyu &quot;eklendi&quot; olarak işaretleyin.
        </p>
      </Card>
      {done.length > 0 && (
        <Card className="mt-6">
          <h2 className="mb-2 font-semibold text-slate-600">Çözülenler</h2>
          <ul>
            {done.map((g) => (
              <Row key={g.key} g={g} resolved ro={ro} />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
