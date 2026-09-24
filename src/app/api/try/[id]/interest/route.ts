import { randomUUID } from "node:crypto";
import { clientIp, hashIp, leadLimiter } from "@/lib/ratelimit";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[\d\s()-]{7,20}$/;

/** "Add this to my site": the business owner leaves contact details after trying the demo. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
  const name = clean(body.name, 80);
  const contact = clean(body.contact, 120);
  if (!name || !(EMAIL.test(contact) || PHONE.test(contact))) return Response.json({ error: "invalid_contact" }, { status: 400 });
  if (body.consent !== true) return Response.json({ error: "consent_required" }, { status: 400 });

  const store = await getStore();
  const assistant = await store.getAssistant(id);
  if (!assistant?.trial) return Response.json({ error: "not_found" }, { status: 404 });
  if (!leadLimiter().check(`try:${hashIp(clientIp(req.headers))}`).ok) return Response.json({ error: "rate_limited" }, { status: 429 });

  await store.addLead({
    id: randomUUID(),
    assistantId: id,
    name,
    contact,
    question: `Kendi sitemde kullanmak istiyorum (${assistant.trial.source}). ${clean(body.message, 300)}`.trim(),
    lang: body.lang === "en" ? "en" : "tr",
    createdAt: new Date().toISOString(),
  });
  // keep interested trials a week longer so the owner can still be shown their demo
  const week = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
  await store.saveAssistant({ ...assistant, trial: { ...assistant.trial, interested: true, expiresAt: week } });
  return Response.json({ ok: true }, { status: 201 });
}
