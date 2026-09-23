export type Lang = "tr" | "en";

export interface AssistantSettings {
  id: string;
  name: string;
  businessName: string;
  color: string;
  welcome: Record<Lang, string>;
  /** Origins allowed to embed the widget. Empty = any origin. */
  allowedOrigins: string[];
  createdAt: string;
}

export interface KnowledgeDocument {
  id: string;
  assistantId: string;
  title: string;
  lang: Lang;
  sourceType: "pdf" | "txt" | "md" | "faq";
  charCount: number;
  chunkCount: number;
  /** Chunks that look like they contain instructions aimed at the model. */
  flaggedChunks: number;
  createdAt: string;
}

export interface Chunk {
  id: string;
  documentId: string;
  assistantId: string;
  lang: Lang;
  title: string;
  heading: string;
  text: string;
  embeddingModel: string;
  embedding: number[];
  suspicious: boolean;
}

export interface SourceRef {
  chunkId: string;
  documentTitle: string;
  heading: string;
  snippet: string;
  score: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: SourceRef[];
  answered?: boolean;
  createdAt: string;
}

export interface Conversation {
  id: string;
  assistantId: string;
  lang: Lang;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

export interface UnansweredQuestion {
  id: string;
  assistantId: string;
  conversationId: string;
  question: string;
  lang: Lang;
  reason: "no_match" | "model_declined" | "error";
  resolved: boolean;
  createdAt: string;
}

export interface Lead {
  id: string;
  assistantId: string;
  conversationId?: string;
  name: string;
  contact: string;
  question: string;
  lang: Lang;
  createdAt: string;
}

export interface ChatResult {
  conversationId: string;
  answer: string;
  answered: boolean;
  /** true when the visitor should be offered the contact form */
  handoff: boolean;
  sources: SourceRef[];
  provider: string;
}
