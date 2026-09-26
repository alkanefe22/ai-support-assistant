import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { handleChat } from "@/lib/chat";
import { localEmbedder } from "@/lib/rag/embeddings";
import { DEMO_ASSISTANT_ID, seedDemo } from "@/lib/seed";
import { PgStore, type Row, type SqlClient } from "@/lib/store/pg-store";
import type { Store } from "@/lib/store/types";
import type { AssistantSettings, Chunk, Conversation, KnowledgeDocument } from "@/lib/types";
import { tempStore } from "./helpers";

/** Real Postgres (PGlite, in-process) behind the same client interface the Neon driver gets. */
function pgliteClient(db: PGlite): SqlClient & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    query: async (text, params) => {
      queries.push(text);
      return (await db.query<Row>(text, params ?? [])).rows;
    },
    batch: async (statements) => {
      await db.transaction(async (tx) => {
        for (const s of statements) {
          queries.push(s.text);
          await tx.query(s.text, s.params ?? []);
        }
      });
    },
  };
}

const assistant = (id: string): AssistantSettings => ({
  id,
  name: `${id} Asistan`,
  businessName: id,
  color: "#0f766e",
  welcome: { tr: "Merhaba", en: "Hi" },
  allowedOrigins: [],
  createdAt: "2026-09-26T00:00:00.000Z",
});
const doc = (assistantId: string, id: string, createdAt: string): KnowledgeDocument => ({
  id,
  assistantId,
  title: id,
  lang: "tr",
  sourceType: "faq",
  charCount: 10,
  chunkCount: 2,
  flaggedChunks: 0,
  createdAt,
});
const chunk = (assistantId: string, documentId: string, id: string): Chunk => ({
  id,
  documentId,
  assistantId,
  lang: "tr",
  title: documentId,
  heading: id,
  text: `metin ${id}`,
  embeddingModel: "local",
  embedding: [0.1, 0.2, 0.3],
  suspicious: false,
});
const convo = (assistantId: string, id: string, updatedAt: string): Conversation => ({
  id,
  assistantId,
  lang: "tr",
  messages: [{ role: "user", text: "soru", at: updatedAt } as never],
  createdAt: updatedAt,
  updatedAt,
});

// The same contract, run against both implementations: Postgres must behave exactly like the JSON file.
const impls: [string, () => Promise<Store>][] = [
  ["JsonStore", async () => tempStore()],
  ["PgStore (PGlite)", async () => new PgStore(pgliteClient(new PGlite()))],
];

describe.each(impls)("Store contract: %s", (_name, make) => {
  let s: Store;
  beforeEach(async () => {
    s = await make();
  });

  it("assistants: save, update, get, list", async () => {
    await s.saveAssistant(assistant("b"));
    await s.saveAssistant(assistant("a"));
    await s.saveAssistant({ ...assistant("a"), color: "#123456" });
    expect((await s.getAssistant("a"))?.color).toBe("#123456");
    expect(await s.getAssistant("yok")).toBeNull();
    expect((await s.listAssistants()).map((a) => a.id).sort()).toEqual(["a", "b"]);
  });

  it("documents and chunks: newest document first, chunks in insertion order, delete cascades", async () => {
    await s.addDocument(doc("a", "d1", "2026-01-01"), [chunk("a", "d1", "c1"), chunk("a", "d1", "c2")]);
    await s.addDocument(doc("a", "d2", "2026-02-01"), [chunk("a", "d2", "c3")]);
    await s.addDocument(doc("b", "x", "2026-03-01"), [chunk("b", "x", "z")]);
    expect((await s.listDocuments("a")).map((d) => d.id)).toEqual(["d2", "d1"]);
    expect((await s.getChunks("a")).map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect((await s.getChunks("a"))[0].embedding).toEqual([0.1, 0.2, 0.3]);
    await s.deleteDocument("a", "d1");
    expect((await s.getChunks("a")).map((c) => c.id)).toEqual(["c3"]);
    await s.replaceChunks("a", [chunk("a", "d2", "n1"), chunk("a", "d2", "n2")]);
    expect((await s.getChunks("a")).map((c) => c.id)).toEqual(["n1", "n2"]);
    expect((await s.getChunks("b")).map((c) => c.id)).toEqual(["z"]);
  });

  it("conversations: upsert, newest first, limit", async () => {
    await s.saveConversation(convo("a", "k1", "2026-01-01"));
    await s.saveConversation(convo("a", "k2", "2026-01-02"));
    await s.saveConversation({ ...convo("a", "k1", "2026-01-03"), lang: "en" });
    expect((await s.getConversation("k1"))?.lang).toBe("en");
    expect((await s.listConversations("a")).map((c) => c.id)).toEqual(["k1", "k2"]);
    expect((await s.listConversations("a", 1)).map((c) => c.id)).toEqual(["k1"]);
    expect(await s.getConversation("yok")).toBeNull();
  });

  it("unanswered questions and leads", async () => {
    const q = { id: "q1", assistantId: "a", conversationId: "k1", question: "?", lang: "tr" as const, reason: "no_match" as const, resolved: false, createdAt: "2026-01-01" };
    await s.addUnanswered(q);
    await s.addUnanswered({ ...q, id: "q2", createdAt: "2026-01-02" });
    await s.setUnansweredResolved("a", "q1", true);
    expect((await s.listUnanswered("a")).map((x) => [x.id, x.resolved])).toEqual([["q2", false], ["q1", true]]);
    await s.addLead({ id: "l1", assistantId: "a", name: "Ali", contact: "ali@ornek.com", question: "?", lang: "tr", createdAt: "2026-01-01" });
    await s.addLead({ id: "l2", assistantId: "a", name: "Ayşe", contact: "0555 000 00 00", question: "?", lang: "tr", createdAt: "2026-01-02" });
    expect((await s.listLeads("a")).map((l) => l.name)).toEqual(["Ayşe", "Ali"]);
    await s.deleteLead("a", "l2");
    expect((await s.listLeads("a")).map((l) => l.id)).toEqual(["l1"]);
  });

  it("daily counter counts per assistant and day and forgets old days", async () => {
    expect(await s.incrementDailyCount("a", "2026-01-01")).toBe(1);
    expect(await s.incrementDailyCount("a", "2026-01-01")).toBe(2);
    expect(await s.incrementDailyCount("b", "2026-01-01")).toBe(1);
    expect(await s.incrementDailyCount("a", "2026-01-02")).toBe(1);
    expect(await s.incrementDailyCount("a", "2026-01-01")).toBe(1); // yesterday's counter was dropped
  });

  it("deleting an assistant removes everything it owns and nothing else", async () => {
    for (const id of ["a", "b"]) {
      await s.saveAssistant(assistant(id));
      await s.addDocument(doc(id, `${id}-d`, "2026-01-01"), [chunk(id, `${id}-d`, `${id}-c`)]);
      await s.saveConversation(convo(id, `${id}-k`, "2026-01-01"));
      await s.addLead({ id: `${id}-l`, assistantId: id, name: "x", contact: "x@y.co", question: "", lang: "tr", createdAt: "2026-01-01" });
    }
    await s.deleteAssistant("a");
    expect(await s.getAssistant("a")).toBeNull();
    expect(await s.getChunks("a")).toEqual([]);
    expect(await s.listDocuments("a")).toEqual([]);
    expect(await s.listConversations("a")).toEqual([]);
    expect(await s.listLeads("a")).toEqual([]);
    expect((await s.getChunks("b")).map((c) => c.id)).toEqual(["b-c"]);
    expect((await s.listLeads("b")).map((l) => l.id)).toEqual(["b-l"]);
  });

  it("the whole product works on it: seeded demo answers with a source", async () => {
    await seedDemo(s);
    const res = await handleChat({ assistantId: DEMO_ASSISTANT_ID, message: "Diş beyazlatma ne kadar?", lang: "tr" }, { store: s, llm: null, embedder: localEmbedder });
    expect(res.answered).toBe(true);
    expect(res.answer).toMatch(/6[.,]?500/);
    expect((await s.listConversations(DEMO_ASSISTANT_ID))[0].id).toBe(res.conversationId);
  });
});

describe("PgStore specifics", () => {
  it("chunks are cached per instance and re-read only after they change", async () => {
    const client = pgliteClient(new PGlite());
    const s = new PgStore(client);
    await s.addDocument(doc("a", "d1", "2026-01-01"), [chunk("a", "d1", "c1")]);
    await s.getChunks("a");
    const reads = () => client.queries.filter((q) => q.startsWith("SELECT data FROM chunks")).length;
    const before = reads();
    await s.getChunks("a");
    await s.getChunks("a");
    expect(reads()).toBe(before); // only the tiny version query ran
    await s.addDocument(doc("a", "d2", "2026-01-02"), [chunk("a", "d2", "c2")]);
    expect((await s.getChunks("a")).map((c) => c.id)).toEqual(["c1", "c2"]);
    await s.deleteDocument("a", "d1");
    expect((await s.getChunks("a")).map((c) => c.id)).toEqual(["c2"]);
    await s.replaceChunks("a", [chunk("a", "d2", "c9")]);
    expect((await s.getChunks("a")).map((c) => c.id)).toEqual(["c9"]);
  });

  it("two instances on one database see each other's writes (serverless: many instances)", async () => {
    const db = new PGlite();
    const one = new PgStore(pgliteClient(db));
    const two = new PgStore(pgliteClient(db));
    await one.addDocument(doc("a", "d1", "2026-01-01"), [chunk("a", "d1", "c1")]);
    expect((await two.getChunks("a")).map((c) => c.id)).toEqual(["c1"]);
    await one.replaceChunks("a", [chunk("a", "d1", "c2")]);
    expect((await two.getChunks("a")).map((c) => c.id)).toEqual(["c2"]);
    expect(await one.incrementDailyCount("a", "d")).toBe(1);
    expect(await two.incrementDailyCount("a", "d")).toBe(2);
  });

  it("only one cold start seeds the demo", async () => {
    const db = new PGlite();
    const claims = await Promise.all([1, 2, 3].map(() => new PgStore(pgliteClient(db)).claimOnce("demo-seeded")));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("a big knowledge base is inserted in batches inside one transaction", async () => {
    const client = pgliteClient(new PGlite());
    const s = new PgStore(client);
    const many = Array.from({ length: 120 }, (_, i) => chunk("a", "d", `c${i}`));
    await s.addDocument(doc("a", "d", "2026-01-01"), many);
    expect(client.queries.filter((q) => q.startsWith("INSERT INTO chunks"))).toHaveLength(3);
    expect((await s.getChunks("a")).map((c) => c.id)).toEqual(many.map((c) => c.id));
  });

  it("text with quotes, Turkish letters and injection-looking content round-trips unchanged", async () => {
    const s = new PgStore(pgliteClient(new PGlite()));
    const tricky = { ...chunk("a", "d", "c"), text: `Robert'); DROP TABLE chunks;-- "tırnak" ığüşöç \\ $1 [[SOURCE:1]]` };
    await s.addDocument(doc("a", "d", "2026-01-01"), [tricky]);
    expect((await s.getChunks("a"))[0].text).toBe(tricky.text);
  });
});
