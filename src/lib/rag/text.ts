import type { Lang } from "../types";

const FOLD: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

/** Lowercases with Turkish rules (İ→i, I→ı) and folds diacritics so "dis" matches "diş". */
export function normalize(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşüâîû]/g, (ch) => FOLD[ch] ?? ch)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

// Stopwords are stored already normalized (folded).
const STOPWORDS = new Set(
  `
  ve veya ile de da ki mi mu mı mü bir bu su o icin gibi daha en cok az ama fakat ancak ise
  ne nedir nasil neden hangi kim zaman olan olarak olur var yok mi misiniz musunuz
  ben sen biz siz onlar benim bizim sizin size bana beni sizi acaba lutfen merhaba tesekkur
  her hic sadece bile kadar sonra once icinde uzerinde yani eger diye yapiyor yapiyorsunuz
  miyim miydi mudur midir olabilir olursa olmak etmek yapmak istiyorum isterim
  a an the and or of to in on at for with by from is are was were be been being do does did
  can could would should will shall may might must i you we they he she it my your our their
  what how why when which who whom this that these those there here please hello hi thanks
  about into than then so if not no yes any some me us them have has had get got
  kanka knk abi abla hocam dostum bro slm mrb selamlar merhabalar sa hey naber tsk tesekkurler sagol peki
  `
    .split(/\s+/)
    .filter(Boolean),
);

/** Crude but effective stemmer for agglutinative Turkish: keep the first 5 characters. */
export function stem(token: string): string {
  return token.length > 5 ? token.slice(0, 5) : token;
}

/**
 * Two stems match if one is a prefix of the other (shorter ≥ 3 chars) or they share
 * a 4-char prefix: covers Turkish suffix variation ("gun"/"gunle", "kapan"/"kapal").
 */
export function stemMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length >= 3 && l.startsWith(s)) return true;
  return s.length >= 4 && l.slice(0, 4) === s.slice(0, 4);
}

// Small, domain-neutral synonym groups for customer-support questions (stems, folded).
const SYNONYM_GROUPS: string[][] = [
  ["kids", "child", "cocuk", "bebek"],
  ["adres", "konum", "nered", "where", "addre", "locat", "ulasi"],
  ["fiyat", "ucret", "price", "cost", "fee", "kac", "much", "lira", "tl", "para", "tutar"],
  ["saat", "acik", "kapal", "hours", "open", "close"],
  ["taksi", "insta", "vade", "odeme", "payme", "pay"],
  ["rande", "appoi", "book", "rezer", "iptal", "cance", "erteleme"],
  ["sure", "suruy", "surer", "surec", "durat", "long"],
];

export function synonymsOf(s: string): string[] {
  const group = SYNONYM_GROUPS.find((g) => g.some((x) => stemMatch(x, s)));
  return group ? group.filter((x) => x !== s) : [];
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

export function stems(text: string): string[] {
  return tokenize(text).map(stem);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const TR_HINTS = /[çğıöşüİ]|\b(ve|bir|bu|ne|nasıl|nedir|mı|mi|var|için|fiyat|randevu|merhaba)\b/i;

export function detectLang(text: string, fallback: Lang = "tr"): Lang {
  if (TR_HINTS.test(text)) return "tr";
  if (/\b(the|what|how|is|are|do|does|can|you|price|appointment|hello)\b/i.test(text)) return "en";
  return fallback;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+(?=[A-ZÇĞİÖŞÜ0-9"“(])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}
