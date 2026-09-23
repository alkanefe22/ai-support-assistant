import type { KnowledgeDocument } from "../types";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_TEXT_CHARS = 200_000;

export function sourceTypeFor(filename: string): KnowledgeDocument["sourceType"] | null {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "pdf") return "pdf";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "txt") return "txt";
  return null;
}

/** Extracts plain text from an uploaded file. PDF parsing uses unpdf (pure JS, serverless-safe). */
export async function extractText(
  bytes: Uint8Array,
  type: KnowledgeDocument["sourceType"],
): Promise<string> {
  if (type === "pdf") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text } = await pdfText(pdf, { mergePages: false });
    // blank line between pages keeps the chunker from gluing pages together
    return (Array.isArray(text) ? text : [text]).join("\n\n");
  }
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}
