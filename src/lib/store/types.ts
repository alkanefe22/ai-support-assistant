import type {
  AssistantSettings,
  Chunk,
  Conversation,
  KnowledgeDocument,
  Lead,
  UnansweredQuestion,
} from "../types";

/**
 * Persistence boundary. The local implementation is a JSON file; a production
 * implementation (e.g. Postgres + pgvector) only has to satisfy this interface.
 */
export interface Store {
  listAssistants(): Promise<AssistantSettings[]>;
  getAssistant(id: string): Promise<AssistantSettings | null>;
  saveAssistant(a: AssistantSettings): Promise<void>;

  listDocuments(assistantId: string): Promise<KnowledgeDocument[]>;
  addDocument(doc: KnowledgeDocument, chunks: Chunk[]): Promise<void>;
  deleteDocument(assistantId: string, documentId: string): Promise<void>;
  getChunks(assistantId: string): Promise<Chunk[]>;
  replaceChunks(assistantId: string, chunks: Chunk[]): Promise<void>;

  getConversation(id: string): Promise<Conversation | null>;
  saveConversation(c: Conversation): Promise<void>;
  listConversations(assistantId: string, limit?: number): Promise<Conversation[]>;

  addUnanswered(q: UnansweredQuestion): Promise<void>;
  listUnanswered(assistantId: string): Promise<UnansweredQuestion[]>;
  setUnansweredResolved(assistantId: string, id: string, resolved: boolean): Promise<void>;

  addLead(l: Lead): Promise<void>;
  listLeads(assistantId: string): Promise<Lead[]>;
  deleteLead(assistantId: string, id: string): Promise<void>;

  /** Increments and returns the request counter for (assistant, day). */
  incrementDailyCount(assistantId: string, day: string): Promise<number>;
}
