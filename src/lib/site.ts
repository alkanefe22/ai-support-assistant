/**
 * The public address this app is served from, for copy-paste snippets (the widget <script> tag).
 * SITE_URL wins; on Vercel the production domain is provided automatically; otherwise the host the
 * request came in on (local development, other hosts).
 */
export function siteUrl(requestHost?: string | null): string {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return `https://${production.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  const host = requestHost?.trim();
  if (host) return `${/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https"}://${host}`;
  return "http://localhost:3000";
}
