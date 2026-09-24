import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Reads a business website for the "try it with your own site" demo.
 *
 * Security: the URL comes from an anonymous visitor, so this is a server-side request forgery
 * (SSRF) surface. Only http(s) on standard ports, every redirect hop re-checked, and every host
 * must resolve exclusively to public addresses (no localhost, private ranges, link-local/cloud
 * metadata). Responses are size-capped and time-limited. (DNS rebinding between the check and the
 * fetch is not fully prevented; acceptable for a demo, documented in the README.)
 */

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "AISupportAssistant-TryBot/1.0 (+demo; reads a few public pages once)";

export class FetchBlockedError extends Error {}

function ipv4ToNum(ip: string): number {
  return ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}

function inRange(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const mask = bits === "0" ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipv4ToNum(ip) & mask) === (ipv4ToNum(base) & mask);
}

const PRIVATE_V4 = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
  "192.0.0.0/24", "192.168.0.0/16", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4",
];

export function isPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) return !PRIVATE_V4.some((c) => inRange(ip, c));
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return false;
    if (v.startsWith("::ffff:")) return isPublicAddress(v.slice(7)); // IPv4-mapped
    if (/^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff")) return false; // ULA, link-local, multicast
    return true;
  }
  return false;
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchBlockedError("Yalnızca http ve https adresleri okunabilir.");
  if (url.username || url.password) throw new FetchBlockedError("Kullanıcı adı içeren adresler kabul edilmez.");
  if (process.env.TRY_ALLOW_PRIVATE === "1") return; // local development / tests only
  if (url.port && url.port !== "80" && url.port !== "443") throw new FetchBlockedError("Standart dışı port kullanılamaz.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new FetchBlockedError("Bu adres okunamaz.");
  }
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) throw new FetchBlockedError("Bu adres okunamaz.");
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size > MAX_BYTES ? chunks.reduce((n, c) => n + c.byteLength, 0) : size);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(buf);
}

/** GET with SSRF checks on every hop. Returns the final URL and the body (HTML/text only). */
export async function safeFetch(input: string): Promise<{ url: URL; body: string; contentType: string }> {
  let url = new URL(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain;q=0.9" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new Error(`Sayfa açılamadı (HTTP ${res.status}).`);
    const contentType = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/.test(contentType)) throw new Error("Bu adres bir web sayfası değil.");
    return { url, body: await readCapped(res), contentType };
  }
  throw new Error("Çok fazla yönlendirme.");
}

// ---------------------------------------------------------------- HTML → text

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", euro: "€", tl: "₺" };

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : undefined;
}

export interface PageInfo {
  url: string;
  title: string;
  siteName?: string;
  themeColor?: string;
  lang?: string;
  /** readable text; headings as "## ", list items as "- " (what the chunker understands) */
  text: string;
  links: string[];
}

const LANG_SWITCHER = /^(##\s*)?([-|/•]?\s*\b(TR|EN|DE|FR|AR|RU|ES|IT|NL)\b\s*[-|/•]?\s*){2,}$/;

/** A heading line for the chunker; decorations like "• " or "1. " dropped. */
function heading(inner: string): string {
  const t = decode(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/^[•·*–—-]\s*/, "").trim();
  return t ? `\n\n## ${t}\n` : "\n";
}

/** Dependency-free readable-text extraction, good enough for typical small-business sites. */
export function extractPage(html: string, pageUrl: URL): PageInfo {
  const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? "";
  const metas = head.match(/<meta\b[^>]*>/gi) ?? [];
  const meta = (key: string) =>
    metas.map((m) => ((attr(m, "property") ?? attr(m, "name"))?.toLowerCase() === key ? attr(m, "content") : undefined)).find(Boolean);
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();

  const links: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    try {
      const u = new URL(decode(m[2] ?? m[3] ?? ""), pageUrl);
      u.hash = "";
      if ((u.protocol === "http:" || u.protocol === "https:") && u.host === pageUrl.host) links.push(u.toString());
    } catch {
      /* ignore malformed hrefs */
    }
  }

  let body = html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  body = body
    .replace(/<(script|style|noscript|svg|template|iframe|canvas|form|select)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // navigation and cookie banners repeat on every page and bury the content
    .replace(/<(nav|header)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*(cookie|consent|gdpr|kvkk-banner)[^>]*>[\s\S]{0,2000}?<\/div>/gi, " ")
    .replace(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi, (_, t) => heading(t))
    .replace(/<(dt|summary)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, t) => heading(t))
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|section|article|li|tr|dd|table|ul|ol|blockquote|footer|main)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<t[dh]\b[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");

  const text = decode(body)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    // "## ?" tooltip buttons, empty bullets, language switchers ("TR | EN | DE")
    .filter((l) => l && l !== "-" && !/^(## )?\s*$/.test(l) && !/^## [^\p{L}\d]*$/u.test(l) && !LANG_SWITCHER.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  return {
    url: pageUrl.toString(),
    title,
    siteName: meta("og:site_name") ?? meta("application-name"),
    themeColor: meta("theme-color"),
    lang: html.match(/<html[^>]*\blang\s*=\s*["']?([a-z]{2})/i)?.[1]?.toLowerCase(),
    text,
    links: [...new Set(links)],
  };
}

// Pages a support assistant needs most, in both languages.
const PRIORITY = /(s\.?s\.?s|sik-?sorulan|faq|soru|help|destek|support|fiyat|ucret|price|pricing|tarife|hizmet|service|urun|product|iletisim|contact|hakkimizda|about|iade|return|kargo|shipping|teslimat|delivery|garanti|warranty|odeme|payment|randevu|appointment|menu|saat|hours|kampanya|sube|magaza|store|location)/i;
// Legal / corporate pages: rarely what a customer asks, and they eat the page budget.
const LOW = /(cerez|cookie|gizlilik|privacy|kvkk|kisisel-veri|aydinlatma|politika|policy|terms|kullanim-kosul|yasal|legal|insan-kaynak|kariyer|career|jobs|basin|press|yatirimci|investor|kalite)/i;
const SKIP = /\.(pdf|jpe?g|png|gif|webp|svg|zip|rar|mp4|mp3|docx?|xlsx?)(\?|$)|\/(wp-admin|wp-login|login|giris|sepet|cart|checkout|hesabim|account|tag|etiket|author|feed)\b|[?&](add-to-cart|replytocom|share)=/i;

const fold = (s: string) =>
  s.toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ö/g, "o").replace(/ü/g, "u");

/** One key per page: "/sss", "/sss/" and "/SSS" are the same page. */
function pageKey(l: string): string {
  const u = new URL(l);
  return `${u.host}${fold(decodeURIComponent(u.pathname)).replace(/\/+$/, "")}${u.search}`;
}

// Other-language copies of the same site ("/en/", "/de/hakkimizda", "?lang=en"): same facts, triple the budget.
const LANG_PATH = /^\/(en|de|fr|ar|ru|es|it|nl|tr)(\/|$|-)|[?&](lang|language|dil)=/i;

export function rankLinks(links: string[], start: URL): string[] {
  const home = pageKey(start.toString());
  const homeLang = LANG_PATH.exec(start.pathname)?.[1]?.toLowerCase();
  const seen = new Set<string>();
  return links
    .filter((l) => {
      const k = pageKey(l);
      const u = new URL(l);
      const lang = LANG_PATH.exec(u.pathname)?.[1]?.toLowerCase() ?? (LANG_PATH.test(u.search) ? "other" : undefined);
      if (SKIP.test(l) || k === home || seen.has(k) || (lang && lang !== homeLang)) return false;
      seen.add(k);
      return true;
    })
    .map((l) => {
      const path = fold(decodeURIComponent(new URL(l).pathname + new URL(l).search));
      const score = (PRIORITY.test(path) ? 10 : 0) - (LOW.test(path) ? 20 : 0) - new URL(l).pathname.split("/").length;
      return { l, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.l);
}

export interface CrawlResult {
  pages: PageInfo[];
  businessName: string;
  themeColor?: string;
  lang: "tr" | "en";
}

const TITLE_SEP = /\s+[|\-–—:·]\s+/;

/**
 * The business name: og:site_name, else the title segment most pages share ("SSS | Kahve Dünyası",
 * "İletişim | Kahve Dünyası" → "Kahve Dünyası"; the home title is often a slogan), else the home
 * title's first segment without its SEO tail ("DentalPark Ağız ve Diş Sağlığı Merkezi, Kayseri Diş, …").
 */
export function guessBusinessName(pages: Pick<PageInfo, "title" | "siteName">[], host: string): string {
  const home = pages[0];
  if (home?.siteName?.trim()) return home.siteName.trim().slice(0, 60);
  const counts = new Map<string, number>();
  for (const p of pages) {
    const segs = p.title.split(TITLE_SEP).map((x) => x.trim());
    if (segs.length < 2) continue;
    for (const seg of new Set(segs)) if (seg.length >= 2) counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  const shared = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (shared) return shared.slice(0, 60);
  const first = (home?.title.split(TITLE_SEP)[0] ?? "").split(",")[0].trim();
  return (first || host.replace(/^www\./, "")).slice(0, 60);
}

/**
 * Lines that repeat on most pages are site chrome (announcement bars, footers, phone banners). Keep
 * them once, on the home page; elsewhere they bury the content and get glued to unrelated text.
 */
export function stripBoilerplate(pages: PageInfo[]): PageInfo[] {
  if (pages.length < 2) return pages;
  const freq = new Map<string, number>();
  for (const p of pages) for (const l of new Set(p.text.split("\n"))) freq.set(l, (freq.get(l) ?? 0) + 1);
  const min = Math.max(2, Math.ceil(pages.length / 2));
  return pages.map((p, i) =>
    i === 0
      ? p
      : { ...p, text: p.text.split("\n").filter((l) => l.length < 15 || (freq.get(l) ?? 0) < min).join("\n").replace(/\n{3,}/g, "\n\n").trim() },
  );
}

/** Home page plus the most relevant same-site pages (FAQ, prices, contact, …), one request at a time. */
export async function crawlSite(startUrl: string, maxPages = 8): Promise<CrawlResult> {
  const first = await safeFetch(startUrl);
  const home = extractPage(first.body, first.url);
  let pages: PageInfo[] = [home];
  const seen = new Set([pageKey(first.url.toString())]);
  const texts = new Set([home.text]);
  for (const link of rankLinks(home.links, first.url)) {
    if (pages.length >= maxPages) break;
    if (seen.has(pageKey(link))) continue;
    seen.add(pageKey(link));
    try {
      const r = await safeFetch(link);
      if (r.url.host !== first.url.host || seen.has(pageKey(r.url.toString())) && r.url.toString() !== link) continue;
      seen.add(pageKey(r.url.toString()));
      const p = extractPage(r.body, r.url);
      // short pages can still matter (a price list); only skip near-empty ones and exact duplicates
      if (p.text.length >= 80 && !texts.has(p.text)) {
        pages.push(p);
        texts.add(p.text);
      }
    } catch {
      /* skip pages that fail; the demo works with whatever was readable */
    }
  }
  pages = stripBoilerplate(pages).filter((p, i) => i === 0 || p.text.length >= 80);
  return {
    pages,
    businessName: guessBusinessName(pages, first.url.hostname),
    themeColor: /^#[0-9a-f]{6}$/i.test(home.themeColor ?? "") ? home.themeColor : undefined,
    lang: home.lang === "en" ? "en" : "tr",
  };
}
