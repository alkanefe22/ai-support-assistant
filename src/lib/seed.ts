import fs from "node:fs/promises";
import path from "node:path";
import { ingestDocument } from "./rag/ingest";
import { localEmbedder, type Embedder } from "./rag/embeddings";
import type { Store } from "./store/types";
import type { AssistantSettings } from "./types";

export const DEMO_ASSISTANT_ID = "gulumse-dis";

export const DEMO_ASSISTANT: AssistantSettings = {
  id: DEMO_ASSISTANT_ID,
  name: "Gülümse Asistan",
  businessName: "Gülümse Diş Kliniği",
  nameEn: "Gülümse Assistant",
  businessNameEn: "Gülümse Dental Clinic",
  color: "#0d9488",
  welcome: {
    tr: "Merhaba! Ben Gülümse Diş Kliniği'nin asistanıyım. Randevu, fiyatlar, tedaviler veya çalışma saatleri hakkında sorabilirsiniz.",
    en: "Hi! I'm the assistant of Gülümse Dental Clinic. Ask me about appointments, prices, treatments or opening hours.",
  },
  allowedOrigins: [],
  createdAt: "2026-09-24T00:00:00.000Z",
};

const SEED_FILES = [
  { file: "gulumse-sss.tr.md", title: "Sıkça Sorulan Sorular (TR)", lang: "tr" as const },
  { file: "gulumse-faq.en.md", title: "Frequently Asked Questions (EN)", lang: "en" as const },
];

export function seedDir() {
  return path.join(process.cwd(), "data", "seed");
}

/** Creates the demo assistant and its knowledge base. Local embeddings keep it free. */
export async function seedDemo(store: Store, embedder: Embedder = localEmbedder) {
  if (await store.getAssistant(DEMO_ASSISTANT_ID)) return;
  await store.saveAssistant(structuredClone(DEMO_ASSISTANT));
  for (const s of SEED_FILES) {
    const text = await fs.readFile(path.join(seedDir(), s.file), "utf8");
    await ingestDocument(
      store,
      { assistantId: DEMO_ASSISTANT_ID, title: s.title, lang: s.lang, sourceType: "md", text },
      embedder,
    );
  }
}
