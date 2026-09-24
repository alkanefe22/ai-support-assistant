/**
 * One-shot end-to-end check against the real provider configured in .env.local.
 * Each question is asked exactly once (no retries) through the app's own handleChat(),
 * using a throwaway store, so the local database is not touched.
 *
 *   npm run live-check
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const QUESTIONS: { lang: "tr" | "en"; q: string; want: "answer" | "handoff" }[] = [
  { lang: "tr", q: "Diş beyazlatma ne kadar?", want: "answer" },
  { lang: "tr", q: "Ağzım kötü kokuyor, ne yapabilirim?", want: "answer" },
  { lang: "en", q: "I have bad breath, can you help?", want: "answer" },
  { lang: "tr", q: "Diş teli takıyor musunuz?", want: "answer" },
  { lang: "tr", q: "Kanal tedavisi ne kadar tutar?", want: "handoff" },
  { lang: "tr", q: "Yirmilik diş çekimi yapıyor musunuz?", want: "handoff" },
  { lang: "en", q: "How much is a root canal?", want: "handoff" },
  { lang: "en", q: "Do you offer veneers?", want: "handoff" },
];

function loadEnvLocal() {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

async function main() {
  loadEnvLocal();
  const { getConfig } = await import("../src/lib/config");
  const { JsonStore } = await import("../src/lib/store/json-store");
  const { seedDemo } = await import("../src/lib/seed");
  const { getEmbedder } = await import("../src/lib/rag/embeddings");
  const { handleChat } = await import("../src/lib/chat");

  const cfg = getConfig();
  if (cfg.provider === "demo") throw new Error("No live provider configured in .env.local");
  const embedder = getEmbedder();
  console.log(`LLM: ${cfg.provider} (${cfg.provider === "gemini" ? cfg.geminiModel : cfg.claudeModel}), embedding: ${embedder.model}\n`);

  const store = new JsonStore(path.join(os.tmpdir(), `aisa-live-${Date.now()}.json`));
  await seedDemo(store, embedder);

  // Free tiers allow only a few requests per minute; space the calls out instead of retrying.
  const gapMs = Number(process.env.LIVE_CHECK_GAP_MS ?? 15_000);
  let ok = 0;
  let errors = 0;
  for (const [i, t] of QUESTIONS.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, gapMs));
    const res = await handleChat({ assistantId: "gulumse-dis", message: t.q, lang: t.lang }, { store });
    const reason = res.answered ? "" : (await store.listUnanswered("gulumse-dis"))[0]?.reason;
    // a provider error proves nothing about the model's behaviour, so it never counts as a pass
    const got = res.answered ? "answer" : reason === "error" ? "error" : "handoff";
    if (got === "error") errors++;
    if (got === t.want) ok++;
    const mark = got === t.want ? "✓" : got === "error" ? "!" : "✗";
    console.log(`${mark} [${t.want}] ${t.q}\n    → ${got}${reason ? ` (${reason})` : ""}: ${res.answer}${res.sources[0] ? `\n    source: ${res.sources[0].heading}` : ""}`);
  }
  console.log(`\n${ok}/${QUESTIONS.length} as expected, ${errors} provider errors`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
