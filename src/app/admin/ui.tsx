export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl bg-white p-5 ring-1 ring-slate-200 ${className}`}>{children}</section>;
}

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={`mb-4 rounded-lg px-4 py-3 text-sm ${error ? "bg-red-50 text-red-800 ring-1 ring-red-200" : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"}`}
    >
      {error ?? ok}
    </div>
  );
}

/** Shown above every form that is disabled for read-only viewers. */
export function ReadOnlyHint({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="mb-3 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
      🔒 Salt okunur demo: bu işlem kapalı.
    </p>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</p>;
}

export const inputCls = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
export const btnCls =
  "rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-400";
export const btnGhostCls =
  "rounded-md px-3 py-1.5 text-sm text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" });
}
