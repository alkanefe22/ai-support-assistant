"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkPassword, createSession, destroySession, requireAdmin, requireWrite } from "@/lib/auth";
import { ingestDocument, reindexAssistant } from "@/lib/rag/ingest";
import { extractText, MAX_UPLOAD_BYTES, sourceTypeFor } from "@/lib/rag/parse";
import { getStore } from "@/lib/store";
import type { Lang } from "@/lib/types";
import { CURRENT_COOKIE, currentAssistant } from "./current";

function str(fd: FormData, key: string, max = 2000): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function langOf(fd: FormData): Lang {
  return str(fd, "lang") === "en" ? "en" : "tr";
}

function back(path: string, params: Record<string, string>): never {
  redirect(`${path}?${new URLSearchParams(params)}`);
}

export async function login(fd: FormData) {
  if (!checkPassword(str(fd, "password", 200))) back("/admin/login", { error: "1" });
  await createSession();
  redirect("/admin");
}

export async function logout() {
  await destroySession();
  redirect("/admin/login");
}

export async function selectAssistant(fd: FormData) {
  await requireAdmin();
  (await cookies()).set(CURRENT_COOKIE, str(fd, "assistantId", 64), { path: "/admin", sameSite: "lax" });
  redirect("/admin");
}

export async function uploadDocument(fd: FormData) {
  await requireWrite("/admin/knowledge");
  const { assistant } = await currentAssistant();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) back("/admin/knowledge", { error: "Dosya seçilmedi." });
  if (file.size > MAX_UPLOAD_BYTES) back("/admin/knowledge", { error: "Dosya 4 MB sınırını aşıyor." });
  const type = sourceTypeFor(file.name);
  if (!type) back("/admin/knowledge", { error: "Yalnızca PDF, TXT ve MD dosyaları desteklenir." });

  let doc;
  try {
    const text = await extractText(new Uint8Array(await file.arrayBuffer()), type);
    doc = await ingestDocument(await getStore(), {
      assistantId: assistant.id,
      title: str(fd, "title", 120) || file.name,
      lang: langOf(fd),
      sourceType: type,
      text,
    });
  } catch (err) {
    back("/admin/knowledge", { error: err instanceof Error ? err.message : "Belge işlenemedi." });
  }
  revalidatePath("/admin", "layout");
  back("/admin/knowledge", { ok: `"${doc.title}" eklendi: ${doc.chunkCount} parça.` });
}

export async function addFaqText(fd: FormData) {
  await requireWrite("/admin/knowledge");
  const { assistant } = await currentAssistant();
  const text = str(fd, "text", 100_000);
  if (text.length < 20) back("/admin/knowledge", { error: "Metin çok kısa." });
  let doc;
  try {
    doc = await ingestDocument(await getStore(), {
      assistantId: assistant.id,
      title: str(fd, "title", 120) || "SSS metni",
      lang: langOf(fd),
      sourceType: "faq",
      text,
    });
  } catch (err) {
    back("/admin/knowledge", { error: err instanceof Error ? err.message : "Metin işlenemedi." });
  }
  revalidatePath("/admin", "layout");
  back("/admin/knowledge", { ok: `"${doc.title}" eklendi: ${doc.chunkCount} parça.` });
}

export async function deleteDocument(fd: FormData) {
  await requireWrite("/admin/knowledge");
  const { assistant } = await currentAssistant();
  await (await getStore()).deleteDocument(assistant.id, str(fd, "id", 64));
  revalidatePath("/admin", "layout");
  back("/admin/knowledge", { ok: "Belge silindi." });
}

export async function reindex() {
  await requireWrite("/admin/knowledge");
  const { assistant } = await currentAssistant();
  let n = 0;
  try {
    n = await reindexAssistant(await getStore(), assistant.id);
  } catch (err) {
    back("/admin/knowledge", { error: err instanceof Error ? err.message : "Yeniden indeksleme başarısız." });
  }
  back("/admin/knowledge", { ok: `${n} parça yeniden indekslendi.` });
}

const COLOR = /^#[0-9a-fA-F]{6}$/;

function parseOrigins(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((o) => o.trim())
    .filter(Boolean)
    .flatMap((o) => {
      try {
        return [new URL(o).origin];
      } catch {
        return [];
      }
    });
}

export async function saveSettings(fd: FormData) {
  await requireWrite("/admin/settings");
  const store = await getStore();
  const { assistant } = await currentAssistant();
  const color = str(fd, "color", 7);
  await store.saveAssistant({
    ...assistant,
    name: str(fd, "name", 60) || assistant.name,
    businessName: str(fd, "businessName", 80) || assistant.businessName,
    color: COLOR.test(color) ? color : assistant.color,
    welcome: {
      tr: str(fd, "welcomeTr", 400) || assistant.welcome.tr,
      en: str(fd, "welcomeEn", 400) || assistant.welcome.en,
    },
    allowedOrigins: parseOrigins(str(fd, "allowedOrigins", 2000)),
  });
  revalidatePath("/admin", "layout");
  back("/admin/settings", { ok: "Ayarlar kaydedildi." });
}

export async function createAssistant(fd: FormData) {
  await requireWrite("/admin/settings");
  const businessName = str(fd, "businessName", 80);
  if (!businessName) back("/admin/settings", { error: "İşletme adı gerekli." });
  const slug =
    businessName
      .toLocaleLowerCase("tr")
      .normalize("NFKD")
      .replace(/ı/g, "i")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "asistan";
  const id = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  await (await getStore()).saveAssistant({
    id,
    name: `${businessName} Asistan`,
    businessName,
    color: "#2563eb",
    welcome: {
      tr: `Merhaba! ${businessName} hakkında sorularınızı yanıtlayabilirim.`,
      en: `Hi! I can answer your questions about ${businessName}.`,
    },
    allowedOrigins: [],
    createdAt: new Date().toISOString(),
  });
  (await cookies()).set(CURRENT_COOKIE, id, { path: "/admin", sameSite: "lax" });
  revalidatePath("/admin", "layout");
  back("/admin/knowledge", { ok: "Yeni asistan oluşturuldu. Şimdi bilgi tabanını yükleyin." });
}

export async function setUnansweredResolved(fd: FormData) {
  await requireWrite("/admin/unanswered");
  const { assistant } = await currentAssistant();
  const ids = str(fd, "ids", 10_000).split(",").filter(Boolean);
  const store = await getStore();
  for (const id of ids) await store.setUnansweredResolved(assistant.id, id, str(fd, "resolved") === "1");
  revalidatePath("/admin/unanswered");
}

export async function deleteLead(fd: FormData) {
  await requireWrite("/admin/leads");
  const { assistant } = await currentAssistant();
  await (await getStore()).deleteLead(assistant.id, str(fd, "id", 64));
  revalidatePath("/admin/leads");
}
