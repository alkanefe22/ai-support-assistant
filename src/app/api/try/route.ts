import { SlidingWindowLimiter, clientIp, hashIp } from "@/lib/ratelimit";
import { getStore } from "@/lib/store";
import { createTrial, trialConfig, TrialError } from "@/lib/try/trial";

export const dynamic = "force-dynamic";
// crawling a few pages and embedding them can take a while on a slow site
export const maxDuration = 120;

const g = globalThis as unknown as { __tryLimiter?: SlidingWindowLimiter };

export async function POST(req: Request) {
  const cfg = trialConfig();
  if (!cfg.enabled) return Response.json({ error: "Deneme şu an kapalı." }, { status: 503 });

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return Response.json({ error: "Geçersiz istek." }, { status: 400 });
  }
  const str = (k: string, max: number) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim().slice(0, max) : "");
  if (str("consent", 5) !== "1") {
    return Response.json({ error: "Devam etmek için bu sitenin sahibi ya da yetkilisi olduğunuzu onaylayın." }, { status: 400 });
  }
  const url = str("url", 500);
  const text = str("text", 60_000);
  const file = fd.get("file");
  const hasFile = file instanceof File && file.size > 0;
  if (!url && !text && !hasFile) return Response.json({ error: "Bir site adresi girin ya da dosya / metin ekleyin." }, { status: 400 });

  // abuse and cost control: per visitor and per day
  const limiter = (g.__tryLimiter ??= new SlidingWindowLimiter(cfg.perIpPerHour, 3_600_000));
  const limit = limiter.check(hashIp(clientIp(req.headers)));
  if (!limit.ok) {
    return Response.json({ error: "Çok fazla deneme yaptınız, lütfen biraz sonra tekrar deneyin." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } });
  }
  const store = await getStore();
  const day = new Date().toISOString().slice(0, 10);
  if ((await store.incrementDailyCount("_try", day)) > cfg.dailyLimit) {
    return Response.json({ error: "Bugünkü deneme kotası doldu, yarın tekrar deneyin." }, { status: 429 });
  }

  try {
    const result = await createTrial(store, {
      url: url || undefined,
      text: text || undefined,
      file: hasFile ? { name: (file as File).name, bytes: new Uint8Array(await (file as File).arrayBuffer()) } : undefined,
      businessName: str("businessName", 60) || undefined,
      lang: str("lang", 2) === "en" ? "en" : str("lang", 2) === "tr" ? "tr" : undefined,
    });
    return Response.json({
      id: result.assistant.id,
      businessName: result.assistant.businessName,
      pages: result.pages,
      chunks: result.chunks,
      suggestions: result.suggestions,
      expiresAt: result.assistant.trial?.expiresAt,
      previewUrl: `/try/${result.assistant.id}`,
    });
  } catch (err) {
    if (err instanceof TrialError) return Response.json({ error: err.message }, { status: err.status });
    console.error("[api/try]", err);
    return Response.json({ error: "Beklenmeyen bir hata oluştu." }, { status: 500 });
  }
}
