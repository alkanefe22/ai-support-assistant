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
        const { seedDemo } = await import("../seed");
        await seedDemo(store);
      }
      return store;
    })();
    g.__store.catch(() => {
      g.__store = undefined;
    });
  }
  return g.__store;
}
