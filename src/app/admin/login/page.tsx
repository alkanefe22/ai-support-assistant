import { redirect } from "next/navigation";
import { authMode, isAdmin } from "@/lib/auth";
import { login } from "../actions";
import { btnCls, inputCls } from "../ui";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isAdmin()) redirect("/admin");
  const { error } = await searchParams;
  const mode = authMode();

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 ring-1 ring-slate-200">
        <h1 className="text-xl font-bold">Yönetim paneli</h1>
        {mode === "locked" ? (
          <p className="mt-3 text-sm text-slate-600">
            Canlı sağlayıcı etkin ama <code>ADMIN_PASSWORD</code> tanımlı değil. Güvenlik için panel kilitli; ortam
            değişkenine bir şifre ekleyip sunucuyu yeniden başlatın.
          </p>
        ) : (
          <form action={login} className="mt-4 space-y-3">
            <label className="block text-sm font-medium" htmlFor="password">
              Şifre
            </label>
            <input id="password" name="password" type="password" required autoFocus className={inputCls} />
            {error && (
              <p role="alert" className="text-sm text-red-700">
                Şifre hatalı.
              </p>
            )}
            <button className={`${btnCls} w-full`}>Giriş</button>
          </form>
        )}
      </div>
    </main>
  );
}
