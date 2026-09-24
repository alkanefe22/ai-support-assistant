import type { Store } from "../store/types";
import type { AssistantSettings, Chunk, Lang } from "../types";
import { cosine, LOCAL_EMBEDDING_MODEL, type Embedder } from "./embeddings";
import { thresholdsFor } from "./retrieval";

/**
 * Per-business "I don't know" threshold, computed from the business's own knowledge base.
 *
 * Every knowledge base scores differently (a dental FAQ and a software help center have different
 * vocabulary and chunk lengths), so one global threshold does not fit all. Instead we ask the KB a
 * fixed set of questions that no customer-support KB should answer (weather, exchange rates, football,
 * homework, …) and put the threshold just above what those unrelated questions score.
 * Near-domain questions that pass are handled by the model's own rules (no answer without a citation).
 *
 * Cost: one batch embedding call per language, only when the documents change.
 */
export const OFF_TOPIC_PROBES: Record<Lang, string[]> = {
  tr: [
    "Yarın İstanbul'da hava nasıl olacak?",
    "Dolar kuru bugün kaç TL?",
    "Galatasaray maçı kaç kaç bitti?",
    "Türkiye'nin başkenti neresidir?",
    "Bana deniz hakkında bir şiir yazar mısın?",
    "Bitcoin fiyatı yükselir mi?",
    "En iyi akıllı telefon hangisi?",
    "Seçim sonuçları ne zaman açıklanır?",
    "Bu akşam hangi filmi izlemeliyim?",
    "İkinci dereceden denklem nasıl çözülür?",
    "Kışlık lastik ne zaman takılmalı?",
    "Ankara'dan İzmir'e uçak bileti ne kadar?",
    "Ehliyet sınavında kaç soru var?",
    "Kedim mama yemiyor ne yapmalıyım?",
    "Osmanlı Devleti ne zaman kuruldu?",
    "Burcuma göre bu hafta nasıl geçecek?",
    "Borsa yarın düşer mi?",
    "Python'da bir liste nasıl sıralanır?",
    "Oyun konsolu almak istiyorum hangisini önerirsin?",
    "Evden çalışırken nasıl motive olurum?",
    "Dünya kupasını en çok kim kazandı?",
    "Kiracı evden çıkmıyor ne yapabilirim?",
    "İngilizce öğrenmek için en iyi uygulama hangisi?",
    "Spor salonunda kilo vermek için ne yapmalıyım?",
  ],
  en: [
    "What will the weather be like tomorrow?",
    "What is the euro to dollar exchange rate today?",
    "Who won the football match last night?",
    "What is the capital of Australia?",
    "Write me a poem about the sea.",
    "Will bitcoin go up this year?",
    "Which smartphone is the best right now?",
    "When will the election results be announced?",
    "What movie should I watch tonight?",
    "How do I solve a quadratic equation?",
    "When should I put on winter tires?",
    "How much is a flight from London to Rome?",
    "How many questions are in the driving test?",
    "My cat won't eat, what should I do?",
    "When did the Roman Empire fall?",
    "What does my horoscope say this week?",
    "Will the stock market crash tomorrow?",
    "How do I sort a list in Python?",
    "Which game console should I buy?",
    "How do I stay motivated working from home?",
    "Which country has won the most World Cups?",
    "My tenant won't move out, what can I do?",
    "What is the best app to learn Spanish?",
    "How do I lose weight at the gym?",
  ],
};

const MARGIN = 0.03;
const PERCENTILE = 0.9; // one or two probes may be accidentally close to a business; don't let them set the bar
const FLOOR = 0.3;
const CEILING = 0.85;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

/** Best cosine of each probe against the chunks (the semantic part of the retrieval score). */
export function probeScores(probeVecs: number[][], chunks: Chunk[]): number[] {
  return probeVecs.map((v) => Math.max(0, ...chunks.map((c) => cosine(v, c.embedding))));
}

export function thresholdFromProbes(scores: number[]): number {
  const sorted = [...scores].sort((a, b) => a - b);
  const t = percentile(sorted, PERCENTILE) + MARGIN;
  return Math.round(Math.min(CEILING, Math.max(FLOOR, t)) * 1000) / 1000;
}

export type RetrievalCalibration = NonNullable<AssistantSettings["retrieval"]>;

/**
 * Recomputes the assistant's thresholds for the embedding model its chunks use.
 * Only semantic models are calibrated (the local word matcher has fixed, tested thresholds).
 * Coverage is not part of the probe score, so the stored calibration uses weightCos = 1.
 */
export async function calibrateAssistant(store: Store, assistantId: string, embedder: Embedder): Promise<RetrievalCalibration | null> {
  const assistant = await store.getAssistant(assistantId);
  if (!assistant) return null;
  const chunks = (await store.getChunks(assistantId)).filter((c) => c.embeddingModel === embedder.model);
  if (embedder.model === LOCAL_EMBEDDING_MODEL || chunks.length === 0) {
    if (assistant.retrieval) await store.saveAssistant({ ...assistant, retrieval: undefined });
    return null;
  }

  const minScore: Partial<Record<Lang, number>> = {};
  const probeMax: Partial<Record<Lang, number>> = {};
  for (const lang of ["tr", "en"] as const) {
    // mirror retrieve(): visitors are searched in their language's chunks, or in all chunks when the
    // KB has none in their language (a Turkish question to an English-only help center)
    const sameLang = chunks.filter((c) => c.lang === lang);
    const pool = sameLang.length > 0 ? sameLang : chunks;
    const vecs = await embedder.embedQueries(OFF_TOPIC_PROBES[lang]);
    const scores = probeScores(vecs, pool);
    minScore[lang] = thresholdFromProbes(scores);
    probeMax[lang] = Math.round(Math.max(...scores) * 1000) / 1000;
  }

  const calibration: RetrievalCalibration = {
    model: embedder.model,
    weightCos: 1,
    minScore,
    probeMax,
    calibratedAt: new Date().toISOString(),
  };
  await store.saveAssistant({ ...assistant, retrieval: calibration });
  return calibration;
}

/** Thresholds for one search: the assistant's own calibration if it matches the model, else the defaults. */
export function assistantThresholds(assistant: AssistantSettings, model: string, lang: Lang) {
  const cal = assistant.retrieval;
  const own = cal && cal.model === model ? cal.minScore[lang] : undefined;
  if (own === undefined) return undefined;
  return { ...thresholdsFor(model), minScore: own, weightCos: cal!.weightCos, minCoverage: 0 };
}
