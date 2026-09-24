import { randomBytes } from "node:crypto";
import { getEmbedder, type Embedder } from "../rag/embeddings";
import { ingestDocument } from "../rag/ingest";
import { extractText, MAX_UPLOAD_BYTES, sourceTypeFor } from "../rag/parse";
import type { Store } from "../store/types";
import type { AssistantSettings, Lang } from "../types";
import { crawlSite, FetchBlockedError } from "./fetchsite";

/**
 * "Try it with your own site": builds a temporary assistant from a visitor's website or file,
 * so a business owner sees the product answering with THEIR prices in about a minute.
 */

export class TrialError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function num(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function trialConfig() {
  return {
    enabled: process.env.TRY_ENABLED !== "false",
    maxPages: num("TRY_MAX_PAGES", 8),
    ttlHours: num("TRY_TTL_HOURS", 24),
    perIpPerHour: num("TRY_PER_IP_PER_HOUR", 3),
    dailyLimit: num("TRY_DAILY_LIMIT", 30),
    /** bounds embedding cost and time per trial */
    maxChars: num("TRY_MAX_CHARS", 60_000),
  };
}

export interface TrialInput {
  url?: string;
  text?: string;
  file?: { name: string; bytes: Uint8Array };
  businessName?: string;
  lang?: Lang;
}

export interface TrialResult {
  assistant: AssistantSettings;
  pages: string[];
  chunks: number;
  flagged: number;
  /** a few headings to suggest as first questions */
  suggestions: string[];
}

export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) throw new TrialError("Site adresi boş.");
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    // "ornek" alone is a typo; localhost is only reachable in local testing (TRY_ALLOW_PRIVATE=1)
    if (!u.hostname.includes(".") && !(process.env.TRY_ALLOW_PRIVATE === "1" && u.hostname === "localhost")) throw new Error();
    return u.toString();
  } catch {
    throw new TrialError("Geçerli bir site adresi girin (örn. ornekisletme.com).");
  }
}

/** "SSS | Kahve Dünyası" → "SSS": the brand is already on every page. */
export function pageLabel(title: string, brand: string): string {
  const segs = title.split(/\s+[|\-–—:·]\s+/).map((x) => x.trim()).filter((x) => x && x !== brand);
  return segs.join(" – ") || title;
}

/** A heading shown as a clickable question: no bullets or numbering, sentence-cased if SHOUTED. */
export function suggestionText(h: string): string {
  const t = h.replace(/^\s*([•·*–—-]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim();
  return t === t.toLocaleUpperCase("tr") && /\p{L}{3}/u.test(t) ? t.charAt(0) + t.slice(1).toLocaleLowerCase("tr") : t;
}

export function isActiveTrial(a: AssistantSettings | null, now = Date.now()): a is AssistantSettings & { trial: NonNullable<AssistantSettings["trial"]> } {
  return !!a?.trial && Date.parse(a.trial.expiresAt) >= now;
}

/** Deletes trial assistants whose time is up (called on every new trial; cheap). */
export async function cleanupExpiredTrials(store: Store, now = Date.now()): Promise<number> {
  const expired = (await store.listAssistants()).filter((a) => a.trial && Date.parse(a.trial.expiresAt) < now);
  for (const a of expired) await store.deleteAssistant(a.id);
  return expired.length;
}

export async function createTrial(store: Store, input: TrialInput, embedder: Embedder = getEmbedder()): Promise<TrialResult> {
  const cfg = trialConfig();
  await cleanupExpiredTrials(store);

  let docs: { title: string; text: string }[] = [];
  let businessName = input.businessName?.trim().slice(0, 60) ?? "";
  let themeColor: string | undefined;
  let lang: Lang = input.lang ?? "tr";
  let source = "";

  if (input.url) {
    const url = normalizeUrl(input.url);
    source = url;
    try {
      const site = await crawlSite(url, cfg.maxPages);
      // the source label customers see: the page's own title, unless it is missing or just the site-wide title
      const homeTitle = site.pages[0]?.title;
      docs = site.pages.map((p, i) => {
        const heading = /^## (.+)$/m.exec(p.text)?.[1].trim();
        if (i === 0) return { title: site.lang === "en" ? "Home page" : "Ana sayfa", text: p.text };
        const own = p.title && p.title !== homeTitle ? pageLabel(p.title, site.businessName) : "";
        return { title: (own || heading || new URL(p.url).pathname).slice(0, 120), text: p.text };
      });
      businessName ||= site.businessName;
      themeColor = site.themeColor;
      lang = input.lang ?? site.lang;
    } catch (err) {
      if (err instanceof FetchBlockedError) throw new TrialError(err.message);
      throw new TrialError(`Site okunamadı: ${err instanceof Error ? err.message : "bilinmeyen hata"}`);
    }
  }
  if (input.file) {
    const type = sourceTypeFor(input.file.name);
    if (!type) throw new TrialError("Yalnızca PDF, TXT ve MD dosyaları desteklenir.");
    if (input.file.bytes.byteLength > MAX_UPLOAD_BYTES) throw new TrialError("Dosya 4 MB sınırını aşıyor.");
    docs.push({ title: input.file.name, text: await extractText(input.file.bytes, type) });
    source ||= input.file.name;
  }
  if (input.text?.trim()) {
    docs.push({ title: "Yapıştırılan metin", text: input.text });
    source ||= "yapıştırılan metin";
  }

  // bound the size, keep the order (home page first, then the most relevant pages)
  let budget = cfg.maxChars;
  docs = docs
    .map((d) => {
      const text = d.text.slice(0, Math.max(0, budget));
      budget -= text.length;
      return { ...d, text };
    })
    .filter((d) => d.text.trim().length > 40);
  const total = docs.reduce((n, d) => n + d.text.length, 0);
  if (total < 200) {
    throw new TrialError(
      input.url
        ? "Siteden yeterli metin okunamadı (site JavaScript ile yükleniyor olabilir). SSS veya fiyat listesini dosya olarak yükleyerek deneyin."
        : "Yeterli metin yok. En az birkaç paragraf SSS / bilgi ekleyin.",
    );
  }

  businessName ||= "İşletmeniz";
  const now = new Date();
  const host = input.url ? new URL(normalizeUrl(input.url)).hostname : source;
  const assistant: AssistantSettings = {
    id: `try-${randomBytes(6).toString("hex")}`,
    name: `${businessName} Asistan`,
    businessName,
    nameEn: `${businessName} Assistant`,
    color: themeColor ?? "#0f766e",
    welcome: {
      tr: `Merhaba! ${businessName} hakkında sorularınızı yanıtlayabilirim. (Deneme: bilgilerimi ${host} kaynağından öğrendim.)`,
      en: `Hi! I can answer your questions about ${businessName}. (Trial: I learned from ${host}.)`,
    },
    allowedOrigins: [],
    createdAt: now.toISOString(),
    trial: {
      source,
      pages: docs.map((d) => d.title),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + cfg.ttlHours * 3_600_000).toISOString(),
    },
  };
  await store.saveAssistant(assistant);

  let chunks = 0;
  let flagged = 0;
  try {
    for (const d of docs) {
      const doc = await ingestDocument(store, { assistantId: assistant.id, title: d.title.slice(0, 120), lang, sourceType: input.url ? "txt" : "faq", text: d.text }, embedder);
      chunks += doc.chunkCount;
      flagged += doc.flaggedChunks;
    }
  } catch (err) {
    await store.deleteAssistant(assistant.id);
    console.error("[try] ingest failed", err instanceof Error ? err.message : err);
    // the embedding provider is down or overloaded; the visitor only needs to know it's temporary
    throw new TrialError("Yapay zekâ hizmetine şu an ulaşılamıyor. Birkaç dakika sonra tekrar deneyin.", 503);
  }

  const headings = (await store.getChunks(assistant.id)).map((c) => suggestionText(c.heading)).filter((h) => /\?$/.test(h) && h.length <= 80);
  return {
    assistant: (await store.getAssistant(assistant.id)) ?? assistant,
    pages: docs.map((d) => d.title),
    chunks,
    flagged,
    suggestions: [...new Set(headings)].slice(0, 4),
  };
}
