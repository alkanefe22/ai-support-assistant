import fs from "node:fs/promises";
import path from "node:path";
import type {
  AssistantSettings,
  Chunk,
  Conversation,
  KnowledgeDocument,
  Lead,
  UnansweredQuestion,
} from "../types";
import type { Store } from "./types";

interface DbShape {
  version: 1;
  assistants: AssistantSettings[];
  documents: KnowledgeDocument[];
  chunks: Chunk[];
  conversations: Conversation[];
  unanswered: UnansweredQuestion[];
  leads: Lead[];
  dailyCounts: Record<string, number>;
}

const MAX_CONVERSATIONS = 2000;

function emptyDb(): DbShape {
  return {
    version: 1,
    assistants: [],
    documents: [],
    chunks: [],
    conversations: [],
    unanswered: [],
    leads: [],
    dailyCounts: {},
  };
}

/**
 * Single-file JSON database. Good enough for local development and demos:
 * zero setup, no native modules. Writes are serialized and atomic (tmp + rename),
 * and the file is reloaded if another process (e.g. the seed script) changed it.
 */
export class JsonStore implements Store {
  private db: DbShape | null = null;
  private loadedMtime = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  static async exists(file: string): Promise<boolean> {
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  }

  private async load(): Promise<DbShape> {
    let mtime = 0;
    try {
      mtime = (await fs.stat(this.file)).mtimeMs;
    } catch {
      /* file does not exist yet */
    }
    if (!this.db || mtime > this.loadedMtime) {
      try {
        const raw = await fs.readFile(this.file, "utf8");
        this.db = { ...emptyDb(), ...(JSON.parse(raw) as DbShape) };
      } catch {
        this.db = emptyDb();
      }
      this.loadedMtime = mtime;
    }
    return this.db;
  }

  private async persist(db: DbShape): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db), "utf8");
    await fs.rename(tmp, this.file);
    this.loadedMtime = (await fs.stat(this.file)).mtimeMs;
  }

  private read<T>(fn: (db: DbShape) => T): Promise<T> {
    const run = this.queue.then(async () => fn(await this.load()));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private write<T>(fn: (db: DbShape) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const db = await this.load();
      const result = fn(db);
      await this.persist(db);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  listAssistants() {
    return this.read((db) => db.assistants.map((a) => structuredClone(a)));
  }
  getAssistant(id: string) {
    return this.read((db) => structuredClone(db.assistants.find((a) => a.id === id) ?? null));
  }
  saveAssistant(a: AssistantSettings) {
    return this.write((db) => {
      const i = db.assistants.findIndex((x) => x.id === a.id);
      if (i >= 0) db.assistants[i] = a;
      else db.assistants.push(a);
    });
  }

  listDocuments(assistantId: string) {
    return this.read((db) =>
      db.documents
        .filter((d) => d.assistantId === assistantId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }
  addDocument(doc: KnowledgeDocument, chunks: Chunk[]) {
    return this.write((db) => {
      db.documents.push(doc);
      db.chunks.push(...chunks);
    });
  }
  deleteDocument(assistantId: string, documentId: string) {
    return this.write((db) => {
      db.documents = db.documents.filter(
        (d) => !(d.assistantId === assistantId && d.id === documentId),
      );
      db.chunks = db.chunks.filter(
        (c) => !(c.assistantId === assistantId && c.documentId === documentId),
      );
    });
  }
  getChunks(assistantId: string) {
    return this.read((db) => db.chunks.filter((c) => c.assistantId === assistantId));
  }
  replaceChunks(assistantId: string, chunks: Chunk[]) {
    return this.write((db) => {
      db.chunks = db.chunks.filter((c) => c.assistantId !== assistantId).concat(chunks);
    });
  }

  getConversation(id: string) {
    return this.read((db) =>
      structuredClone(db.conversations.find((c) => c.id === id) ?? null),
    );
  }
  saveConversation(c: Conversation) {
    return this.write((db) => {
      const i = db.conversations.findIndex((x) => x.id === c.id);
      if (i >= 0) db.conversations[i] = c;
      else db.conversations.push(c);
      if (db.conversations.length > MAX_CONVERSATIONS) {
        db.conversations.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
        db.conversations = db.conversations.slice(-MAX_CONVERSATIONS);
      }
    });
  }
  listConversations(assistantId: string, limit = 100) {
    return this.read((db) =>
      db.conversations
        .filter((c) => c.assistantId === assistantId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit),
    );
  }

  addUnanswered(q: UnansweredQuestion) {
    return this.write((db) => {
      db.unanswered.push(q);
    });
  }
  listUnanswered(assistantId: string) {
    return this.read((db) =>
      db.unanswered
        .filter((q) => q.assistantId === assistantId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }
  setUnansweredResolved(assistantId: string, id: string, resolved: boolean) {
    return this.write((db) => {
      const q = db.unanswered.find((x) => x.assistantId === assistantId && x.id === id);
      if (q) q.resolved = resolved;
    });
  }

  addLead(l: Lead) {
    return this.write((db) => {
      db.leads.push(l);
    });
  }
  listLeads(assistantId: string) {
    return this.read((db) =>
      db.leads
        .filter((l) => l.assistantId === assistantId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }
  deleteLead(assistantId: string, id: string) {
    return this.write((db) => {
      db.leads = db.leads.filter((l) => !(l.assistantId === assistantId && l.id === id));
    });
  }

  incrementDailyCount(assistantId: string, day: string) {
    return this.write((db) => {
      // keep only today's counters
      for (const k of Object.keys(db.dailyCounts)) {
        if (!k.endsWith(`:${day}`)) delete db.dailyCounts[k];
      }
      const key = `${assistantId}:${day}`;
      db.dailyCounts[key] = (db.dailyCounts[key] ?? 0) + 1;
      return db.dailyCounts[key];
    });
  }
}
