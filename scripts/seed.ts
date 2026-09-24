/**
 * Resets the local database and seeds the demo assistant (Gülümse Diş Kliniği).
 *   npm run seed
 * Uses the embedding provider from .env.local (semantic search in live mode); if that provider is
 * unreachable it falls back to the free local index. The app also seeds automatically on first start.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../src/lib/config";
import { getEmbedder, localEmbedder } from "../src/lib/rag/embeddings";
import { DEMO_ASSISTANT_ID, seedDemo } from "../src/lib/seed";
import { JsonStore } from "../src/lib/store/json-store";

async function main() {
  if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
  const file = path.join(dataDir(), "db.json");
  fs.rmSync(file, { force: true });
  const store = new JsonStore(file);
  const embedder = getEmbedder();
  try {
    await seedDemo(store, embedder);
    console.log(`Embeddings: ${embedder.model}`);
  } catch (err) {
    console.error(`Embedding provider failed (${err instanceof Error ? err.message : err}); using local embeddings`);
    await store.deleteAssistant(DEMO_ASSISTANT_ID);
    await seedDemo(store, localEmbedder);
  }
  const docs = await store.listDocuments(DEMO_ASSISTANT_ID);
  console.log(`Seeded ${file}`);
  for (const d of docs) console.log(`  - ${d.title}: ${d.chunkCount} chunks`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
