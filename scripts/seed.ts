/**
 * Resets the local database and seeds the demo assistant (Gülümse Diş Kliniği).
 *   npm run seed
 * The app also seeds automatically on first start when no database exists.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../src/lib/config";
import { seedDemo } from "../src/lib/seed";
import { JsonStore } from "../src/lib/store/json-store";

async function main() {
  const file = path.join(dataDir(), "db.json");
  fs.rmSync(file, { force: true });
  const store = new JsonStore(file);
  await seedDemo(store);
  const docs = await store.listDocuments("gulumse-dis");
  console.log(`Seeded ${file}`);
  for (const d of docs) console.log(`  - ${d.title}: ${d.chunkCount} chunks`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
