import type { AssistantSettings } from "./types";

/**
 * Widget endpoints are called cross-origin from customer sites. If the assistant has
 * an origin allow-list, only those origins (and our own) may call them.
 */
export function originAllowed(req: Request, assistant: AssistantSettings | null): boolean {
  const origin = req.headers.get("origin");
  if (!origin || !assistant || assistant.allowedOrigins.length === 0) return true;
  const self = new URL(req.url).origin;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin === self || (host && new URL(origin).host === host)) return true;
  return assistant.allowedOrigins.some((o) => o.replace(/\/$/, "") === origin);
}

export function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...corsHeaders(req), ...extra } });
}

export function preflight(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
