import { json, originAllowed, preflight } from "@/lib/cors";
import { getStore } from "@/lib/store";
import { displayNames } from "@/lib/types";

export const dynamic = "force-dynamic";

export function OPTIONS(req: Request) {
  return preflight(req);
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("assistant") ?? "";
  const assistant = await (await getStore()).getAssistant(id);
  if (!assistant) return json(req, { error: "not_found" }, 404);
  if (!originAllowed(req, assistant)) return json(req, { error: "origin_not_allowed" }, 403);
  return json(
    req,
    {
      id: assistant.id,
      name: assistant.name,
      businessName: assistant.businessName,
      // per-language header texts for the widget (falls back to the default names)
      names: { tr: displayNames(assistant, "tr"), en: displayNames(assistant, "en") },
      color: assistant.color,
      welcome: assistant.welcome,
    },
    200,
    { "Cache-Control": "public, max-age=60" },
  );
}
