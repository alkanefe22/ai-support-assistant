import path from "node:path";
import { dataDir } from "../config";
import { JsonStore } from "./json-store";
import type { Store } from "./types";

export type { Store } from "./types";

const g = globalThis as unknown as { __store?: Promise<Store> };

/** Postgres when DATABASE_URL is set (Neon via the Vercel Marketplace), else the local JSON file. */
export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL?.trim() || undefined;
}

async function seed(store: Store): Promise<void> {
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

/**
 * Returns the process-wide store. On first use with an empty database (fresh clone, first
 * deploy) the demo assistant is seeded automatically, once.
 */
export function getStore(): Promise<Store> {
  if (!g.__store) {
    g.__store = (async () => {
      const url = databaseUrl();
      if (url) {
        const { PgStore, neonClient } = await import("./pg-store");
        const store = new PgStore(await neonClient(url));
        await store.init();
        // several cold starts can race on a fresh database: only the one that claims seeds
        if (await store.claimOnce("demo-seeded")) {
          try {
            await seed(store);
          } catch (err) {
            await store.releaseClaim("demo-seeded");
            throw err;
          }
        }
        return store;
      }
      const file = path.join(dataDir(), "db.json");
      const fresh = !(await JsonStore.exists(file));
      const store = new JsonStore(file);
      if (fresh) await seed(store);
      return store;
    })();
    g.__store.catch(() => {
      g.__store = undefined;
    });
  }
  return g.__store;
}
