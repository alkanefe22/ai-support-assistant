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

type Outcome = "answer" | "chat" | "handoff";

/**
 * want: what a correct assistant does.
 *   answer  = a knowledge-base answer WITH a source
 *   chat    = a friendly conversational reply (no source, no lead form)
 *   handoff = "I don't know" + lead form
 * semantic: only answerable with a semantic embedding (Gemini / Ollama). With the local word-matching
 *   search the honest expectation is a hand-off, never a brush-off chat reply.
 */
const QUESTIONS: { lang: "tr" | "en"; q: string; want: Outcome; semantic?: boolean }[] = [
  { lang: "tr", q: "Diş beyazlatma ne kadar?", want: "answer" },
  { lang: "tr", q: "Ağzım kötü kokuyor, ne yapabilirim?", want: "answer", semantic: true },
  { lang: "en", q: "I have bad breath, can you help?", want: "answer", semantic: true },
  { lang: "tr", q: "Ağzım kötü kokuyor", want: "answer", semantic: true }, // a complaint, no question words
  { lang: "tr", q: "Diş teli takıyor musunuz?", want: "answer", semantic: true },
  { lang: "tr", q: "Kanal tedavisi ne kadar tutar?", want: "handoff" },
  { lang: "tr", q: "Yirmilik diş çekimi yapıyor musunuz?", want: "handoff" },
  { lang: "en", q: "How much is a root canal?", want: "handoff" },
  { lang: "en", q: "Do you offer veneers?", want: "handoff" },
  { lang: "tr", q: "bugün keyfim yerinde be", want: "chat" },
  { lang: "tr", q: "naber kanka nasıl gidiyor", want: "chat" },
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
  const model = { gemini: cfg.geminiModel, claude: cfg.claudeModel, ollama: cfg.ollamaModel, demo: "-" }[cfg.provider];
  console.log(`LLM: ${cfg.provider} (${model}), embedding: ${embedder.model}\n`);

  const store = new JsonStore(path.join(os.tmpdir(), `aisa-live-${Date.now()}.json`));
  await seedDemo(store, embedder);

  // Free tiers allow only a few requests per minute; space the calls out instead of retrying.
  // a local Ollama model has no rate limit, so no gap by default
  const gapMs = Number(process.env.LIVE_CHECK_GAP_MS ?? (cfg.provider === "ollama" ? 0 : 15_000));
  let ok = 0;
  let errors = 0;
  for (const [i, t] of QUESTIONS.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, gapMs));
    const res = await handleChat({ assistantId: "gulumse-dis", message: t.q, lang: t.lang }, { store });
    const reason = res.answered ? "" : (await store.listUnanswered("gulumse-dis"))[0]?.reason;
    // an "answer" must cite the knowledge base; a sourceless reply is a chat reply.
    // A provider error proves nothing about the model's behaviour, so it never counts as a pass.
    const got = res.answered ? (res.sources.length > 0 ? "answer" : "chat") : reason === "error" ? "error" : "handoff";
    const want: Outcome = t.semantic && embedder.model === "local-hash-v1" ? "handoff" : t.want;
    if (got === "error") errors++;
    if (got === want) ok++;
    const mark = got === want ? "✓" : got === "error" ? "!" : "✗";
    const note = want !== t.want ? " (yerel arama eşanlamlıyı bulamaz: dürüst sonuç yönlendirme)" : "";
    console.log(`${mark} [${want}]${note} ${t.q}\n    → ${got}${reason ? ` (${reason})` : ""}: ${res.answer}${res.sources[0] ? `\n    source: ${res.sources[0].heading}` : ""}`);
  }
  console.log(`\n${ok}/${QUESTIONS.length} as expected, ${errors} provider errors`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
