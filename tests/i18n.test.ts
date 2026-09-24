import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { GET as widgetConfig } from "@/app/api/widget/config/route";
import { handleChat } from "@/lib/chat";
import type { LlmProvider } from "@/lib/llm";
import { localEmbedder } from "@/lib/rag/embeddings";
import { DEMO_ASSISTANT, DEMO_ASSISTANT_ID } from "@/lib/seed";
import { getStore } from "@/lib/store";
import { displayNames } from "@/lib/types";
import { seededStore } from "./helpers";

beforeAll(() => {
  // fresh auto-seeded database for the route handler (never reuse a stale local db)
  process.env.DATA_DIR = path.join(os.tmpdir(), "aisa-i18n-tests", randomUUID());
  delete (globalThis as { __store?: unknown }).__store;
});

describe("localized assistant names", () => {
  it("uses English names for English visitors and Turkish names otherwise", () => {
    expect(displayNames(DEMO_ASSISTANT, "tr")).toEqual({ name: "Gülümse Asistan", businessName: "Gülümse Diş Kliniği" });
    expect(displayNames(DEMO_ASSISTANT, "en")).toEqual({ name: "Gülümse Assistant", businessName: "Gülümse Dental Clinic" });
  });

  it("falls back to the default names when no English name is set", () => {
    const a = { ...DEMO_ASSISTANT, nameEn: "", businessNameEn: undefined };
    expect(displayNames(a, "en")).toEqual({ name: "Gülümse Asistan", businessName: "Gülümse Diş Kliniği" });
  });

  it("widget config sends the header texts for both languages", async () => {
    await getStore();
    const res = await widgetConfig(new Request(`http://localhost/api/widget/config?assistant=${DEMO_ASSISTANT_ID}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.names).toEqual({
      tr: { name: "Gülümse Asistan", businessName: "Gülümse Diş Kliniği" },
      en: { name: "Gülümse Assistant", businessName: "Gülümse Dental Clinic" },
    });
    // older widget builds still read these
    expect(body.name).toBe("Gülümse Asistan");
    expect(body.businessName).toBe("Gülümse Diş Kliniği");
  });

  it("the model introduces itself with the English name to English visitors", async () => {
    const store = await seededStore();
    const llm: LlmProvider = { name: "gemini", generate: vi.fn(async () => "In-office whitening costs 6,500 TL.") };
    await handleChat(
      { assistantId: DEMO_ASSISTANT_ID, message: "How much is teeth whitening?", lang: "en" },
      { store, llm, embedder: localEmbedder },
    );
    const { system } = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(system).toContain('"Gülümse Assistant"');
    expect(system).toContain("Gülümse Dental Clinic");
    expect(system).not.toContain("Diş Kliniği");
  });
});
