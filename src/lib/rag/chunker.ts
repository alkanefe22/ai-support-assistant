import { splitSentences } from "./text";

export interface RawChunk {
  heading: string;
  text: string;
}

export interface ChunkOptions {
  maxChars?: number;
}

interface Section {
  heading: string;
  paragraphs: string[];
}

const MD_HEADING = /^#{1,6}\s+(.+?)\s*#*$/;
// "S: ...?" / "Q: ...?" / a short standalone line ending in "?" is treated as a FAQ question.
const FAQ_QUESTION = /^(?:(?:S|Soru|Q|Question)\s*[:.-]\s*)?(.{3,160}\?)$/i;
const FAQ_ANSWER_PREFIX = /^(?:C|Cevap|A|Answer)\s*[:.-]\s*/i;

function toSections(text: string): Section[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const sections: Section[] = [{ heading: "", paragraphs: [] }];
  let buf: string[] = [];

  const flush = () => {
    const p = buf.join(" ").replace(/\s+/g, " ").trim();
    if (p) sections[sections.length - 1].paragraphs.push(p);
    buf = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim().replace(/^>\s?/, "");
    const md = line.match(MD_HEADING);
    const faq = !md && line.match(FAQ_QUESTION);
    if (md || faq) {
      flush();
      sections.push({ heading: (md ? md[1] : faq![1]).trim(), paragraphs: [] });
      continue;
    }
    if (!line) {
      flush();
      continue;
    }
    // bullets become their own paragraphs so they don't get glued together
    if (/^[-*•]\s+/.test(line)) {
      flush();
      buf.push(line);
      flush();
      continue;
    }
    buf.push(line.replace(FAQ_ANSWER_PREFIX, ""));
  }
  flush();
  return sections.filter((s) => s.paragraphs.length > 0);
}

/** Splits a single oversized paragraph on sentence boundaries (hard-cuts as a last resort). */
function splitLong(p: string, maxChars: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const s of splitSentences(p)) {
    const pieces = s.length > maxChars ? s.match(new RegExp(`.{1,${maxChars}}`, "gs")) ?? [s] : [s];
    for (const piece of pieces) {
      if (cur && cur.length + piece.length + 1 > maxChars) {
        out.push(cur);
        cur = "";
      }
      cur = cur ? `${cur} ${piece}` : piece;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Structure-aware chunker: sections are cut at markdown headings or FAQ questions,
 * then packed into chunks of at most `maxChars`. When a section spans several chunks,
 * the last sentence of the previous chunk is carried over for context.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): RawChunk[] {
  const maxChars = opts.maxChars ?? 700;
  const chunks: RawChunk[] = [];

  for (const section of toSections(text)) {
    const paragraphs = section.paragraphs.flatMap((p) =>
      p.length > maxChars ? splitLong(p, maxChars) : [p],
    );
    let cur = "";
    for (const p of paragraphs) {
      if (cur && cur.length + p.length + 1 > maxChars) {
        chunks.push({ heading: section.heading, text: cur });
        const last = splitSentences(cur).at(-1) ?? "";
        cur = last && last.length < maxChars / 3 ? last : "";
      }
      cur = cur ? `${cur}\n${p}` : p;
    }
    if (cur) chunks.push({ heading: section.heading, text: cur });
  }
  return chunks;
}
