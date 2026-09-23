import { json, originAllowed, preflight } from "@/lib/cors";
import { getStore } from "@/lib/store";

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
      color: assistant.color,
      welcome: assistant.welcome,
    },
    200,
    { "Cache-Control": "public, max-age=60" },
  );
}
