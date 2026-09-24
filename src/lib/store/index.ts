import path from "node:path";
import { dataDir } from "../config";
import { JsonStore } from "./json-store";
import type { Store } from "./types";

export type { Store } from "./types";

const g = globalThis as unknown as { __store?: Promise<Store> };

/**
 * Returns the process-wide store. On first use with an empty data directory
 * (fresh clone, Vercel cold start) the demo assistant is seeded automatically.
 */
export function getStore(): Promise<Store> {
  if (!g.__store) {
    g.__store = (async () => {
      const file = path.join(dataDir(), "db.json");
      const fresh = !(await JsonStore.exists(file));
      const store = new JsonStore(file);
      if (fresh) {
        const { seedDemo, DEMO_ASSISTANT_ID } = await import("../seed");
        const { getEmbedder, localEmbedder } = await import("../rag/embeddings");
        // with a semantic embedding provider (live mode) the demo gets real semantic search;
        // if that provider is unreachable, fall back to the free local index instead of failing
        try {
          await seedDemo(store, getEmbedder());
        } catch (err) {
          console.error("[store] semantic seeding failed, using local embeddings", err instanceof Error ? err.message : err);
          await store.deleteAssistant(DEMO_ASSISTANT_ID);
          await seedDemo(store, localEmbedder);
        }
      }
      return store;
    })();
    g.__store.catch(() => {
      g.__store = undefined;
    });
  }
  return g.__store;
}
