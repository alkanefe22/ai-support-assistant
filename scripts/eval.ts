/**
 * Large end-to-end evaluation against the provider configured in .env.local
 * (meant for the free local Ollama model; with a paid API every case costs a call).
 *
 *   npm run eval                 # all cases once
 *   EVAL_REPEAT=3 npm run eval   # every case 3x, reports flaky cases
 *   EVAL_CAT=yazim-hatasi npm run eval
 *   EVAL_BIZ=taskflow npm run eval   # one business: gulumse-dis, berrak-su, moda-sepeti, lezzet-duragi, taskflow
 *
 * Checks per case: outcome (answer / chat / handoff), the cited section, required and forbidden
 * text, reply language, and grounding: every number in an answer must occur in the cited chunks
 * or in the question (catches invented prices). Report: data/tmp/eval-report.md
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUSINESSES, BUSINESS_CASES } from "../eval/businesses";
import { CASES, type EvalCase, type Outcome } from "./eval-cases";

function loadEnvLocal() {
  if (!fs.existsSync(".env.local")) return;
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

/** "6.500", "6,500" and "6500" are the same number; "3-6" is two numbers. */
function numbers(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d{3})*(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
}

const TR_WORDS = /\b(ve|bir|için|ile|bu|veya|olarak|kliniğimiz|yapıyoruz|değil|evet|hayır|ücret|fiyat)\b|[çğışöü]{1}\w*(yor|dir|tır|dır|lar|ler)\b/giu;
const EN_WORDS = /\b(the|and|you|your|we|our|is|are|for|with|can|yes|no|price|cost)\b/gi;
function wrongLanguage(text: string, lang: "tr" | "en"): boolean {
  const tr = (text.match(TR_WORDS) ?? []).length;
  const en = (text.match(EN_WORDS) ?? []).length;
  return lang === "tr" ? en > tr + 1 : tr > en + 1;
}

interface Result {
  c: EvalCase;
  got: Outcome | "error";
  answer: string;
  sources: string[];
  problems: string[];
  ms: number;
}

async function main() {
  loadEnvLocal();
  const { getConfig } = await import("../src/lib/config");
  const { JsonStore } = await import("../src/lib/store/json-store");
  const { seedDemo } = await import("../src/lib/seed");
  const { getEmbedder } = await import("../src/lib/rag/embeddings");
  const { handleChat } = await import("../src/lib/chat");
  const { ingestDocument } = await import("../src/lib/rag/ingest");

  const cfg = getConfig();
  const embedder = getEmbedder();
  const model = { gemini: cfg.geminiModel, claude: cfg.claudeModel, ollama: cfg.ollamaModel, demo: "-" }[cfg.provider];
  if (cfg.provider !== "ollama" && cfg.provider !== "demo" && !process.env.EVAL_ALLOW_PAID) {
    throw new Error(`Provider ${cfg.provider} costs money per call; set EVAL_ALLOW_PAID=1 to run the eval anyway.`);
  }
  const repeat = Math.max(1, Number(process.env.EVAL_REPEAT ?? 1));
  const all: EvalCase[] = [...CASES.map((c) => ({ biz: "gulumse-dis", ...c })), ...BUSINESS_CASES];
  const cases = all
    .filter((c) => !process.env.EVAL_CAT || c.cat === process.env.EVAL_CAT)
    .filter((c) => !process.env.EVAL_BIZ || c.biz === process.env.EVAL_BIZ);
  console.log(`LLM: ${cfg.provider} (${model}) · embedding: ${embedder.model} · ${cases.length} cases × ${repeat}\n`);

  // every business gets its own assistant, knowledge base and (automatic) threshold
  const store = new JsonStore(path.join(os.tmpdir(), `aisa-eval-${Date.now()}.json`));
  await seedDemo(store, embedder);
  for (const b of BUSINESSES) {
    await store.saveAssistant({
      id: b.id,
      name: b.name,
      businessName: b.businessName,
      color: "#2563eb",
      welcome: { tr: "Merhaba!", en: "Hi!" },
      allowedOrigins: [],
      createdAt: new Date().toISOString(),
    });
    for (const d of b.docs) {
      const text = fs.readFileSync(d.file, "utf8");
      const sourceType = d.file.endsWith(".txt") ? "txt" : "md";
      await ingestDocument(store, { assistantId: b.id, title: d.title, lang: d.lang, sourceType, text }, embedder);
    }
  }
  const chunkText = new Map<string, string>();
  const calibration: string[] = [];
  for (const a of await store.listAssistants()) {
    for (const c of await store.getChunks(a.id)) chunkText.set(c.id, `${c.heading}\n${c.text}`);
    calibration.push(`${a.id} ${a.retrieval ? JSON.stringify(a.retrieval.minScore) : "(default)"}`);
  }
  console.log(`thresholds: ${calibration.join(" · ")}\n`);

  const results: Result[] = [];
  const t0 = Date.now();
  for (let round = 0; round < repeat; round++) {
    for (const c of cases) {
      const start = Date.now();
      let conversationId: string | undefined;
      for (const turn of c.turns ?? []) {
        conversationId = (await handleChat({ assistantId: c.biz!, message: turn, lang: c.lang, conversationId }, { store })).conversationId;
      }
      const res = await handleChat({ assistantId: c.biz!, message: c.q, lang: c.lang, conversationId }, { store });
      const reason = res.answered ? "" : (await store.listUnanswered(c.biz!))[0]?.reason;
      const got: Result["got"] = res.answered ? (res.sources.length ? "answer" : "chat") : reason === "error" ? "error" : "handoff";
      const problems: string[] = [];
      if (!c.want.includes(got as Outcome)) problems.push(`outcome ${got}, wanted ${c.want.join("/")}`);
      if (got === "answer") {
        if (c.heading && !res.sources.some((s) => c.heading!.test(s.heading))) {
          problems.push(`wrong section: ${res.sources.map((s) => s.heading).join(" | ")}`);
        }
        const cited = res.sources.map((s) => chunkText.get(s.chunkId) ?? "").join("\n");
        const allowed = new Set([...numbers(cited), ...numbers(c.q), ...(c.turns ?? []).flatMap(numbers)]);
        const invented = numbers(res.answer).filter((n) => !allowed.has(n));
        if (invented.length) problems.push(`numbers not in the cited source: ${invented.join(", ")}`);
        for (const re of c.include ?? []) if (!re.test(res.answer)) problems.push(`missing ${re}`);
      }
      for (const re of c.exclude ?? []) if (re.test(res.answer)) problems.push(`forbidden ${re}`);
      if ((got === "answer" || got === "chat") && wrongLanguage(res.answer, c.lang)) problems.push(`wrong language`);
      results.push({ c, got, answer: res.answer, sources: res.sources.map((s) => s.heading), problems, ms: Date.now() - start });
      process.stdout.write(problems.length ? "✗" : "·");
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);

  // ---- report ----
  const byCat = new Map<string, Result[]>();
  for (const r of results) byCat.set(r.c.cat, [...(byCat.get(r.c.cat) ?? []), r]);
  const byBiz = new Map<string, Result[]>();
  for (const r of results) byBiz.set(r.c.biz!, [...(byBiz.get(r.c.biz!) ?? []), r]);
  const pass = results.filter((r) => r.problems.length === 0).length;
  const lines: string[] = [
    `# Eval report`,
    ``,
    `${cfg.provider} (${model}) · ${embedder.model} · ${cases.length} cases × ${repeat} · ${secs}s`,
    ``,
    `**Total: ${pass}/${results.length} (${Math.round((pass / results.length) * 100)}%)**`,
    ``,
    `| Business | Pass |`,
    `|---|---|`,
    ...[...byBiz].map(([b, rs]) => `| ${b} | ${rs.filter((r) => !r.problems.length).length}/${rs.length} |`),
    ``,
    `Thresholds: ${calibration.join(" · ")}`,
    ``,
    `| Category | Pass |`,
    `|---|---|`,
    ...[...byCat].map(([cat, rs]) => `| ${cat} | ${rs.filter((r) => !r.problems.length).length}/${rs.length} |`),
    ``,
    `## Failures`,
    ``,
  ];
  const seen = new Map<string, { r: Result; n: number }>();
  for (const r of results.filter((x) => x.problems.length)) {
    const key = `${r.c.biz}|${r.c.cat}|${r.c.q}`;
    seen.set(key, { r, n: (seen.get(key)?.n ?? 0) + 1 });
  }
  for (const { r, n } of seen.values()) {
    lines.push(
      `- **[${r.c.biz} / ${r.c.cat}]** ${r.c.turns ? `(${r.c.turns.join(" → ")}) → ` : ""}"${r.c.q}"${repeat > 1 ? ` (${n}/${repeat} runs)` : ""}`,
      `  - ${r.problems.join("; ")}`,
      `  - reply: ${r.answer.replace(/\s+/g, " ").slice(0, 220)}${r.sources.length ? ` [source: ${r.sources.join(" | ")}]` : ""}`,
    );
  }
  const report = lines.join("\n");
  fs.mkdirSync("data/tmp", { recursive: true });
  fs.writeFileSync("data/tmp/eval-report.md", report);
  fs.writeFileSync("data/tmp/eval-results.json", JSON.stringify(results.map((r) => ({ ...r, c: { ...r.c, heading: r.c.heading?.source } })), null, 1));
  console.log(`\n\n${report}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
