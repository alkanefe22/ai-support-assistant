import { describe, expect, it } from "vitest";
import { handleChat } from "@/lib/chat";
import { localEmbedder } from "@/lib/rag/embeddings";
import { ingestDocument } from "@/lib/rag/ingest";
import { extractText, sourceTypeFor } from "@/lib/rag/parse";
import { DEMO_ASSISTANT_ID } from "@/lib/seed";
import { seededStore } from "./helpers";

/** Builds a tiny valid single-page PDF with one text line per entry (ASCII only). */
function makePdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = [
    "BT /F1 12 Tf 14 TL 50 780 Td",
    ...lines.map((l) => `(${esc(l)}) Tj T*`),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

describe("document parsing", () => {
  it("detects supported file types", () => {
    expect(sourceTypeFor("menu.PDF")).toBe("pdf");
    expect(sourceTypeFor("faq.md")).toBe("md");
    expect(sourceTypeFor("notes.txt")).toBe("txt");
    expect(sourceTypeFor("image.png")).toBeNull();
  });

  it("decodes UTF-8 text and strips the BOM", async () => {
    const bytes = new TextEncoder().encode("﻿Diş beyazlatma");
    expect(await extractText(bytes, "txt")).toBe("Diş beyazlatma");
  });

  it("extracts text from a PDF and makes it answerable", async () => {
    const pdf = makePdf([
      "Do you offer night sedation?",
      "Yes, sedation for anxious patients is available on Thursdays with an anesthesiologist.",
    ]);
    const text = await extractText(pdf, "pdf");
    expect(text).toMatch(/night sedation/);

    const store = await seededStore();
    const doc = await ingestDocument(
      store,
      { assistantId: DEMO_ASSISTANT_ID, title: "Sedation.pdf", lang: "en", sourceType: "pdf", text },
      localEmbedder,
    );
    expect(doc.chunkCount).toBeGreaterThan(0);
    const res = await handleChat(
      { assistantId: DEMO_ASSISTANT_ID, message: "Is sedation available for anxious patients?", lang: "en" },
      { store, llm: null, embedder: localEmbedder },
    );
    expect(res.answered).toBe(true);
    expect(res.answer).toMatch(/Thursdays/);
    expect(res.sources[0].documentTitle).toBe("Sedation.pdf");
  });
});
