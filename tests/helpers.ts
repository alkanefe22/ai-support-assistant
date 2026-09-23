import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { JsonStore } from "@/lib/store/json-store";
import { seedDemo } from "@/lib/seed";

export function tempStore() {
  return new JsonStore(path.join(os.tmpdir(), "ai-support-assistant-tests", `${randomUUID()}.json`));
}

export async function seededStore() {
  const store = tempStore();
  await seedDemo(store);
  return store;
}
