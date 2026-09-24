import { randomUUID } from "node:crypto";
import { looksLikeInjection } from "../prompt";
import type { Store } from "../store";
import type { Chunk, KnowledgeDocument, Lang } from "../types";
import { calibrateAssistant } from "./autocalibrate";
import { chunkText } from "./chunker";
import { getEmbedder, type Embedder } from "./embeddings";
import { MAX_TEXT_CHARS } from "./parse";
import { indexTextFor } from "./retrieval";

export interface IngestInput {
  assistantId: string;
  title: string;
  lang: Lang;
  sourceType: KnowledgeDocument["sourceType"];
  text: string;
}

export async function ingestDocument(
  store: Store,
  input: IngestInput,
  embedder: Embedder = getEmbedder(),
): Promise<KnowledgeDocument> {
  const text = input.text.slice(0, MAX_TEXT_CHARS);
  const raw = chunkText(text);
  if (raw.length === 0) throw new Error("Belgede okunabilir metin bulunamadı.");

  const documentId = randomUUID();
  const title = input.title.trim().slice(0, 120) || "Belge";
  const base = raw.map((r) => ({ heading: r.heading || title, text: r.text }));
  const vectors = await embedder.embedDocuments(base.map(indexTextFor));

  const chunks: Chunk[] = base.map((r, i) => ({
    id: randomUUID(),
    documentId,
    assistantId: input.assistantId,
    lang: input.lang,
    title,
    heading: r.heading,
    text: r.text,
    embeddingModel: embedder.model,
    embedding: vectors[i],
    suspicious: looksLikeInjection(`${r.heading}\n${r.text}`),
  }));

  const doc: KnowledgeDocument = {
    id: documentId,
    assistantId: input.assistantId,
    title,
    lang: input.lang,
    sourceType: input.sourceType,
    charCount: text.length,
    chunkCount: chunks.length,
    flaggedChunks: chunks.filter((c) => c.suspicious).length,
    createdAt: new Date().toISOString(),
  };
  await store.addDocument(doc, chunks);
  await recalibrate(store, input.assistantId, embedder);
  return doc;
}

/**
 * Keeps the assistant's "I don't know" threshold in step with its knowledge base. A failure here
 * (e.g. the embedding provider is down) must not lose the upload: the previous or default
 * threshold stays in use.
 */
export async function recalibrate(store: Store, assistantId: string, embedder: Embedder = getEmbedder()) {
  try {
    await calibrateAssistant(store, assistantId, embedder);
  } catch (err) {
    console.error("[ingest] calibration failed", err instanceof Error ? err.message : err);
  }
}

/** Re-embeds every chunk with the current embedder (after switching EMBEDDING_PROVIDER). */
export async function reindexAssistant(store: Store, assistantId: string, embedder: Embedder = getEmbedder()) {
  const chunks = await store.getChunks(assistantId);
  const vectors = await embedder.embedDocuments(chunks.map(indexTextFor));
  await store.replaceChunks(
    assistantId,
    chunks.map((c, i) => ({ ...c, embedding: vectors[i], embeddingModel: embedder.model })),
  );
  await recalibrate(store, assistantId, embedder);
  return chunks.length;
}
