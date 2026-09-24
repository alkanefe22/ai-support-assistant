"use client";

import { useState } from "react";

type Widget = { ask?: (q: string) => Promise<void>; open?: () => Promise<void> };

/** Suggested first questions: one click asks them in the widget. */
export function AskButtons({ questions, color }: { questions: string[]; color: string }) {
  const ask = (q: string) => {
    const w = (window as unknown as { AISupportAssistant?: Widget }).AISupportAssistant;
    if (w?.ask) void w.ask(q);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {questions.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => ask(q)}
          className="rounded-full border bg-white px-3 py-1.5 text-left text-sm hover:bg-slate-50"
          style={{ borderColor: color, color }}
        >
          {q}
        </button>
      ))}
    </div>
  );
}

/** "Add this to my site": the business owner's contact details go to the platform owner's panel. */
export function InterestForm({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setState("busy");
    const res = await fetch(`/api/try/${id}/interest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        contact: fd.get("contact"),
        message: fd.get("message"),
        consent: fd.get("consent") === "on",
      }),
    }).catch(() => null);
    if (res?.ok) {
      setState("done");
      return;
    }
    const body = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
    setMsg(
      body.error === "invalid_contact"
        ? "Adınızı ve geçerli bir e-posta ya da telefon girin."
        : body.error === "consent_required"
          ? "Onay kutusunu işaretleyin."
          : "Gönderilemedi, lütfen tekrar deneyin.",
    );
    setState("error");
  }

  if (state === "done") {
    return (
      <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
        Teşekkürler! En kısa sürede sizinle iletişime geçeceğiz. Bu deneme bir hafta daha açık kalacak.
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input name="name" required maxLength={80} placeholder="Adınız" aria-label="Adınız" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <input name="contact" required maxLength={120} placeholder="E-posta veya telefon" aria-label="E-posta veya telefon" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <input name="message" maxLength={300} placeholder="Not (isteğe bağlı)" aria-label="Not" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <label className="flex items-start gap-2 text-xs text-slate-600">
        <input type="checkbox" name="consent" className="mt-0.5" /> İletişim bilgilerimin bu talep için kullanılmasına izin veriyorum.
      </label>
      {state === "error" && (
        <p role="alert" className="text-sm text-red-700">
          {msg}
        </p>
      )}
      <button disabled={state === "busy"} className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
        {state === "busy" ? "Gönderiliyor…" : "Bunu sitemde istiyorum"}
      </button>
    </form>
  );
}
