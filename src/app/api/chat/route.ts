import { ChatError, handleChat } from "@/lib/chat";
import { getConfig } from "@/lib/config";
import { json, originAllowed, preflight } from "@/lib/cors";
import { chatLimiter, clientIp, hashIp } from "@/lib/ratelimit";
import { getStore } from "@/lib/store";
import type { Lang } from "@/lib/types";

export const dynamic = "force-dynamic";

export function OPTIONS(req: Request) {
  return preflight(req);
}

export async function POST(req: Request) {
  let body: { assistantId?: unknown; message?: unknown; conversationId?: unknown; lang?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "invalid_json" }, 400);
  }
  const assistantId = typeof body.assistantId === "string" ? body.assistantId : "";
  const message = typeof body.message === "string" ? body.message : "";
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : undefined;
  const lang: Lang | undefined = body.lang === "tr" || body.lang === "en" ? body.lang : undefined;

  const store = await getStore();
  const assistant = await store.getAssistant(assistantId);
  if (!assistant) return json(req, { error: "not_found" }, 404);
  if (!originAllowed(req, assistant)) return json(req, { error: "origin_not_allowed" }, 403);

  const limit = chatLimiter().check(`${assistantId}:${hashIp(clientIp(req.headers))}`);
  if (!limit.ok) {
    return json(req, { error: "rate_limited", retryAfter: limit.retryAfterSec }, 429, {
      "Retry-After": String(limit.retryAfterSec),
    });
  }
  const day = new Date().toISOString().slice(0, 10);
  if ((await store.incrementDailyCount(assistantId, day)) > getConfig().dailyRequestLimit) {
    return json(req, { error: "daily_limit" }, 429);
  }

  try {
    const result = await handleChat({ assistantId, message, conversationId, lang }, { store });
    return json(req, result);
  } catch (err) {
    if (err instanceof ChatError) {
      const status = err.code === "not_found" ? 404 : 400;
      return json(req, { error: err.code }, status);
    }
    console.error("[api/chat]", err);
    return json(req, { error: "internal" }, 500);
  }
}
