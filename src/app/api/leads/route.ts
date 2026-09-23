import { randomUUID } from "node:crypto";
import { json, originAllowed, preflight } from "@/lib/cors";
import { clientIp, hashIp, leadLimiter } from "@/lib/ratelimit";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[\d\s()-]{7,20}$/;

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
}

export function OPTIONS(req: Request) {
  return preflight(req);
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "invalid_json" }, 400);
  }
  const assistantId = clean(body.assistantId, 64);
  const store = await getStore();
  const assistant = await store.getAssistant(assistantId);
  if (!assistant) return json(req, { error: "not_found" }, 404);
  if (!originAllowed(req, assistant)) return json(req, { error: "origin_not_allowed" }, 403);

  const name = clean(body.name, 80);
  const contact = clean(body.contact, 120);
  const question = clean(body.question, 500);
  if (!name || !(EMAIL.test(contact) || PHONE.test(contact))) {
    return json(req, { error: "invalid_contact" }, 400);
  }
  if (body.consent !== true) return json(req, { error: "consent_required" }, 400);

  if (!leadLimiter().check(`${assistantId}:${hashIp(clientIp(req.headers))}`).ok) {
    return json(req, { error: "rate_limited" }, 429);
  }

  await store.addLead({
    id: randomUUID(),
    assistantId,
    conversationId: clean(body.conversationId, 64) || undefined,
    name,
    contact,
    question,
    lang: body.lang === "en" ? "en" : "tr",
    createdAt: new Date().toISOString(),
  });
  return json(req, { ok: true }, 201);
}
