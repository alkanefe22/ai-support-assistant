"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const STEPS = ["Siteniz okunuyor…", "Önemli sayfalar bulunuyor (SSS, fiyatlar, iletişim)…", "Bilgi tabanı oluşturuluyor…", "Asistanınız hazırlanıyor…"];

export function TryForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"url" | "file">("url");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 4000);
    return () => clearInterval(t);
  }, [busy]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    fd.set("consent", fd.get("consent") ? "1" : "");
    if (mode === "url") {
      fd.delete("file");
      fd.delete("text");
    } else {
      fd.delete("url");
    }
    setBusy(true);
    setStep(0);
    try {
      const res = await fetch("/api/try", { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { error?: string; previewUrl?: string };
      if (!res.ok || !body.previewUrl) throw new Error(body.error ?? "Bir hata oluştu.");
      router.push(body.previewUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bir hata oluştu.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1 text-sm" role="tablist">
        {(["url", "file"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1.5 font-medium ${mode === m ? "bg-white shadow-sm" : "text-slate-600"}`}
          >
            {m === "url" ? "Site adresi" : "Dosya veya metin"}
          </button>
        ))}
      </div>

      <fieldset disabled={busy} className="space-y-4">
        {mode === "url" ? (
          <label className="block">
            <span className="text-sm font-medium text-slate-700">İşletmenizin web sitesi</span>
            <input
              name="url"
              required
              inputMode="url"
              placeholder="ornekisletme.com"
              className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-3 text-lg"
              autoFocus
            />
            <span className="mt-1 block text-xs text-slate-500">Ana sayfa ve en önemli sayfalar (SSS, fiyatlar, iletişim, iade…) okunur, en fazla 8 sayfa.</span>
          </label>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">SSS / fiyat listesi dosyası (PDF, TXT, MD)</span>
              <input type="file" name="file" accept=".pdf,.txt,.md,.markdown" className="mt-1 block w-full text-sm" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">veya metni yapıştırın</span>
              <textarea name="text" rows={5} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={"S: Kargo ücretli mi?\nC: 500 TL üzeri siparişlerde ücretsiz."} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">İşletme adı</span>
              <input name="businessName" maxLength={60} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
          </div>
        )}

        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input type="checkbox" name="consent" required className="mt-1" />
          <span>Bu sitenin / içeriğin sahibi ya da yetkilisiyim. Okunan içerik yalnızca bu deneme için kullanılır ve 24 saat sonra silinir.</span>
        </label>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
            {error}
          </p>
        )}

        <button className="w-full rounded-lg bg-teal-700 px-5 py-3 text-lg font-semibold text-white hover:bg-teal-800 disabled:cursor-wait disabled:opacity-70">
          {busy ? STEPS[step] : "Asistanımı oluştur"}
        </button>
      </fieldset>
    </form>
  );
}
