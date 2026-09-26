import type {
  AssistantSettings,
  Chunk,
  Conversation,
  KnowledgeDocument,
  Lead,
  UnansweredQuestion,
} from "../types";
import type { Store } from "./types";

/**
 * Postgres persistence (Neon in production, PGlite in tests). Each table keeps the few columns it
 * is queried by plus the whole record as jsonb, so behaviour matches the JSON store exactly and a
 * new field on a record never needs a migration.
 */

export type Row = Record<string, unknown>;
export interface Statement {
  text: string;
  params?: unknown[];
}
/** The two operations the store needs; implemented by the Neon HTTP driver and by PGlite. */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<Row[]>;
  /** Runs the statements in one transaction. */
  batch(statements: Statement[]): Promise<void>;
}

const MAX_CONVERSATIONS = 2000;
/** rows per INSERT when adding chunks (each carries an embedding) */
const CHUNK_BATCH = 50;

export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS assistants (id text PRIMARY KEY, data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS documents (assistant_id text NOT NULL, id text NOT NULL, created_at text NOT NULL, data jsonb NOT NULL, PRIMARY KEY (assistant_id, id))`,
  `CREATE TABLE IF NOT EXISTS chunks (ord bigserial PRIMARY KEY, assistant_id text NOT NULL, document_id text NOT NULL, data jsonb NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS chunks_assistant ON chunks (assistant_id, ord)`,
  `CREATE TABLE IF NOT EXISTS conversations (id text PRIMARY KEY, assistant_id text NOT NULL, updated_at text NOT NULL, data jsonb NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS conversations_assistant ON conversations (assistant_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS unanswered (assistant_id text NOT NULL, id text NOT NULL, created_at text NOT NULL, data jsonb NOT NULL, PRIMARY KEY (assistant_id, id))`,
  `CREATE TABLE IF NOT EXISTS leads (assistant_id text NOT NULL, id text NOT NULL, created_at text NOT NULL, data jsonb NOT NULL, PRIMARY KEY (assistant_id, id))`,
  `CREATE TABLE IF NOT EXISTS daily_counts (assistant_id text NOT NULL, day text NOT NULL, n integer NOT NULL, PRIMARY KEY (assistant_id, day))`,
  `CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL)`,
];

const json = (v: unknown) => JSON.stringify(v);
const data = <T>(rows: Row[]) => rows.map((r) => (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as T);

export class PgStore implements Store {
  private ready: Promise<void> | null = null;
  /**
   * Chunks with their embeddings are read on every question and can be megabytes; keep them per
   * server instance and re-read only when the assistant's chunk set changed (count / newest row).
   */
  private chunkCache = new Map<string, { version: string; chunks: Chunk[] }>();

  constructor(private readonly sql: SqlClient) {}

  /** Creates the tables once per instance (idempotent). */
  init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.sql.batch(SCHEMA.map((text) => ({ text }))).catch((err) => {
        this.ready = null;
        throw err;
      });
    }
    return this.ready;
  }

  private async q(text: string, params?: unknown[]): Promise<Row[]> {
    await this.init();
    return this.sql.query(text, params);
  }
  private async tx(statements: Statement[]): Promise<void> {
    await this.init();
    if (statements.length > 0) await this.sql.batch(statements);
  }

  /** True for exactly one caller ever: used so that only one cold start seeds the demo. */
  async claimOnce(key: string): Promise<boolean> {
    const rows = await this.q(`INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING key`, [
      key,
      new Date().toISOString(),
    ]);
    return rows.length === 1;
  }
  async releaseClaim(key: string): Promise<void> {
    await this.q(`DELETE FROM meta WHERE key = $1`, [key]);
  }

  // ------------------------------------------------------------------ assistants

  async listAssistants() {
    return data<AssistantSettings>(await this.q(`SELECT data FROM assistants ORDER BY id`));
  }
  async getAssistant(id: string) {
    return data<AssistantSettings>(await this.q(`SELECT data FROM assistants WHERE id = $1`, [id]))[0] ?? null;
  }
  async saveAssistant(a: AssistantSettings) {
    await this.q(`INSERT INTO assistants (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [
      a.id,
      json(a),
    ]);
  }
  async deleteAssistant(id: string) {
    this.chunkCache.delete(id);
    await this.tx(
      ["assistants WHERE id", "documents WHERE assistant_id", "chunks WHERE assistant_id", "conversations WHERE assistant_id", "unanswered WHERE assistant_id", "leads WHERE assistant_id", "daily_counts WHERE assistant_id"].map(
        (t) => ({ text: `DELETE FROM ${t} = $1`, params: [id] }),
      ),
    );
  }

  // ------------------------------------------------------------------ knowledge base

  async listDocuments(assistantId: string) {
    return data<KnowledgeDocument>(await this.q(`SELECT data FROM documents WHERE assistant_id = $1 ORDER BY created_at DESC`, [assistantId]));
  }
  async addDocument(doc: KnowledgeDocument, chunks: Chunk[]) {
    await this.tx([
      {
        text: `INSERT INTO documents (assistant_id, id, created_at, data) VALUES ($1, $2, $3, $4::jsonb)`,
        params: [doc.assistantId, doc.id, doc.createdAt, json(doc)],
      },
      ...chunkInserts(chunks),
    ]);
  }
  async deleteDocument(assistantId: string, documentId: string) {
    await this.tx([
      { text: `DELETE FROM documents WHERE assistant_id = $1 AND id = $2`, params: [assistantId, documentId] },
      { text: `DELETE FROM chunks WHERE assistant_id = $1 AND document_id = $2`, params: [assistantId, documentId] },
    ]);
  }
  async getChunks(assistantId: string) {
    const [v] = await this.q(`SELECT count(*)::text AS n, coalesce(max(ord), 0)::text AS last FROM chunks WHERE assistant_id = $1`, [assistantId]);
    const version = `${v?.n}:${v?.last}`;
    const cached = this.chunkCache.get(assistantId);
    if (cached?.version === version) return cached.chunks;
    const chunks = data<Chunk>(await this.q(`SELECT data FROM chunks WHERE assistant_id = $1 ORDER BY ord`, [assistantId]));
    if (this.chunkCache.size > 200) this.chunkCache.clear();
    this.chunkCache.set(assistantId, { version, chunks });
    return chunks;
  }
  async replaceChunks(assistantId: string, chunks: Chunk[]) {
    await this.tx([{ text: `DELETE FROM chunks WHERE assistant_id = $1`, params: [assistantId] }, ...chunkInserts(chunks)]);
  }

  // ------------------------------------------------------------------ conversations

  async getConversation(id: string) {
    return data<Conversation>(await this.q(`SELECT data FROM conversations WHERE id = $1`, [id]))[0] ?? null;
  }
  async saveConversation(c: Conversation) {
    await this.tx([
      {
        text: `INSERT INTO conversations (id, assistant_id, updated_at, data) VALUES ($1, $2, $3, $4::jsonb)
               ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at, data = EXCLUDED.data`,
        params: [c.id, c.assistantId, c.updatedAt, json(c)],
      },
      // same cap as the JSON store: the oldest conversations beyond it are dropped
      {
        text: `DELETE FROM conversations WHERE id IN (SELECT id FROM conversations ORDER BY updated_at DESC OFFSET $1)`,
        params: [MAX_CONVERSATIONS],
      },
    ]);
  }
  async listConversations(assistantId: string, limit = 100) {
    return data<Conversation>(
      await this.q(`SELECT data FROM conversations WHERE assistant_id = $1 ORDER BY updated_at DESC LIMIT $2`, [assistantId, limit]),
    );
  }

  // ------------------------------------------------------------------ unanswered questions and leads

  async addUnanswered(q: UnansweredQuestion) {
    await this.q(`INSERT INTO unanswered (assistant_id, id, created_at, data) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING`, [
      q.assistantId,
      q.id,
      q.createdAt,
      json(q),
    ]);
  }
  async listUnanswered(assistantId: string) {
    return data<UnansweredQuestion>(await this.q(`SELECT data FROM unanswered WHERE assistant_id = $1 ORDER BY created_at DESC`, [assistantId]));
  }
  async setUnansweredResolved(assistantId: string, id: string, resolved: boolean) {
    await this.q(`UPDATE unanswered SET data = jsonb_set(data, '{resolved}', to_jsonb($3::boolean)) WHERE assistant_id = $1 AND id = $2`, [
      assistantId,
      id,
      resolved,
    ]);
  }

  async addLead(l: Lead) {
    await this.q(`INSERT INTO leads (assistant_id, id, created_at, data) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING`, [
      l.assistantId,
      l.id,
      l.createdAt,
      json(l),
    ]);
  }
  async listLeads(assistantId: string) {
    return data<Lead>(await this.q(`SELECT data FROM leads WHERE assistant_id = $1 ORDER BY created_at DESC`, [assistantId]));
  }
  async deleteLead(assistantId: string, id: string) {
    await this.q(`DELETE FROM leads WHERE assistant_id = $1 AND id = $2`, [assistantId, id]);
  }

  // ------------------------------------------------------------------ limits

  async incrementDailyCount(assistantId: string, day: string) {
    // one atomic upsert: correct under concurrent requests on several instances
    const [row] = await this.q(
      `INSERT INTO daily_counts (assistant_id, day, n) VALUES ($1, $2, 1)
       ON CONFLICT (assistant_id, day) DO UPDATE SET n = daily_counts.n + 1 RETURNING n`,
      [assistantId, day],
    );
    // keep only today's counters (cheap, and only when a new day starts for this assistant)
    if (Number(row.n) === 1) await this.q(`DELETE FROM daily_counts WHERE day <> $1`, [day]);
    return Number(row.n);
  }
}

function chunkInserts(chunks: Chunk[]): Statement[] {
  const out: Statement[] = [];
  for (let i = 0; i < chunks.length; i += CHUNK_BATCH) {
    const part = chunks.slice(i, i + CHUNK_BATCH);
    out.push({
      text: `INSERT INTO chunks (assistant_id, document_id, data) VALUES ${part.map((_, j) => `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3}::jsonb)`).join(", ")}`,
      params: part.flatMap((c) => [c.assistantId, c.documentId, json(c)]),
    });
  }
  return out;
}

/** The production client: Neon's HTTP driver (no connection to keep open from a serverless function). */
export async function neonClient(url: string): Promise<SqlClient> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  return {
    query: (text, params) => sql.query(text, params ?? []) as Promise<Row[]>,
    batch: async (statements) => {
      await sql.transaction(statements.map((s) => sql.query(s.text, s.params ?? [])));
    },
  };
}
