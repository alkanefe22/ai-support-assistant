import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ---- Next.js request APIs, mocked so real server actions can run inside Vitest ----
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => void cookieJar.set(name, value),
    delete: (name: string) => void cookieJar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import * as actions from "@/app/admin/actions";
import { GET as exportLeads } from "@/app/admin/(panel)/leads/export/route";
import { adminAccess, createSession, READ_ONLY_MESSAGE, resolveAccess } from "@/lib/auth";
import { maskContact, maskEmail, maskName, maskPhone, redactPII } from "@/lib/privacy";
import { DEMO_ASSISTANT_ID } from "@/lib/seed";
import { getStore } from "@/lib/store";

const ENV_KEYS = ["PUBLIC_DEMO", "ADMIN_PASSWORD", "AI_PROVIDER"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function fd(fields: Record<string, string | File>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

/** Runs a server action and returns the URL it redirected to (actions always end in a redirect or return). */
async function run(action: (f: FormData) => Promise<unknown>, form: FormData = fd({})): Promise<string | null> {
  try {
    await action(form);
    return null;
  } catch (err) {
    const m = err instanceof Error && err.message.match(/^REDIRECT:(.*)$/);
    if (m) return m[1];
    throw err;
  }
}

async function snapshot() {
  const store = await getStore();
  return JSON.stringify({
    docs: await store.listDocuments(DEMO_ASSISTANT_ID),
    chunks: (await store.getChunks(DEMO_ASSISTANT_ID)).length,
    assistants: await store.listAssistants(),
    leads: await store.listLeads(DEMO_ASSISTANT_ID),
    unanswered: await store.listUnanswered(DEMO_ASSISTANT_ID),
  });
}

beforeAll(async () => {
  process.env.DATA_DIR = path.join(os.tmpdir(), "aisa-readonly-tests", randomUUID());
  delete (globalThis as { __store?: unknown }).__store;
  const store = await getStore(); // auto-seeds the demo assistant
  await store.addLead({
    id: "lead-1",
    assistantId: DEMO_ASSISTANT_ID,
    name: "Ayşe Demir",
    contact: "ayse.demir@example.com",
    question: "Beni 0532 123 45 67 numarasından arayın",
    lang: "tr",
    createdAt: new Date().toISOString(),
  });
  await store.addUnanswered({
    id: "q-1",
    assistantId: DEMO_ASSISTANT_ID,
    conversationId: "c-1",
    question: "Göz muayenesi yapıyor musunuz?",
    lang: "tr",
    reason: "no_match",
    resolved: false,
    createdAt: new Date().toISOString(),
  });
});

beforeEach(() => {
  cookieJar.clear();
  process.env.AI_PROVIDER = "demo";
  delete process.env.ADMIN_PASSWORD;
  delete process.env.PUBLIC_DEMO;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("access decision", () => {
  it.each([
    // mode,        publicDemo, sessionValid, expected
    ["open-demo", false, false, "full"], // local demo on your own machine
    ["open-demo", true, false, "readonly"], // public demo without a password
    ["password", true, false, "readonly"], // public demo, visitor not logged in
    ["password", true, true, "full"], // public demo, owner logged in
    ["password", false, false, "none"], // private deployment, not logged in
    ["password", false, true, "full"],
    ["locked", false, false, "none"], // live provider without password: closed
    ["locked", true, false, "readonly"], // ...unless explicitly a public read-only demo
  ] as const)("%s, publicDemo=%s, session=%s → %s", (mode, publicDemo, sessionValid, expected) => {
    expect(resolveAccess({ mode, publicDemo, sessionValid })).toBe(expected);
  });
});

describe("public read-only demo: server actions refuse every change", () => {
  const readOnlyRedirect = (p: string) => `${p}?${new URLSearchParams({ error: READ_ONLY_MESSAGE })}`;

  beforeEach(() => {
    process.env.PUBLIC_DEMO = "true";
  });

  it("visitors get read-only access without a password", async () => {
    expect(await adminAccess()).toBe("readonly");
  });

  it.each([
    ["uploadDocument", "/admin/knowledge", () => fd({ file: new File(["S: Test?\nC: Evet."], "a.txt"), lang: "tr" })],
    ["addFaqText", "/admin/knowledge", () => fd({ text: "S: Kargo ücretli mi?\nC: Hayır, ücretsizdir.", lang: "tr" })],
    ["reindex", "/admin/knowledge", () => fd({})],
    ["saveSettings", "/admin/settings", () => fd({ name: "HACKED", businessName: "HACKED", color: "#000000", allowedOrigins: "" })],
    ["createAssistant", "/admin/settings", () => fd({ businessName: "Yeni İşletme" })],
    ["setUnansweredResolved", "/admin/unanswered", () => fd({ ids: "q-1", resolved: "1" })],
    ["deleteLead", "/admin/leads", () => fd({ id: "lead-1" })],
  ] as const)("%s is blocked and nothing changes", async (name, backTo, form) => {
    const before = await snapshot();
    const url = await run(actions[name] as (f: FormData) => Promise<unknown>, form());
    expect(url).toBe(readOnlyRedirect(backTo));
    expect(await snapshot()).toBe(before);
  });

  it("deleteDocument is blocked and the document survives", async () => {
    const store = await getStore();
    const [doc] = await store.listDocuments(DEMO_ASSISTANT_ID);
    const url = await run(actions.deleteDocument, fd({ id: doc.id }));
    expect(url).toBe(readOnlyRedirect("/admin/knowledge"));
    expect((await store.listDocuments(DEMO_ASSISTANT_ID)).map((d) => d.id)).toContain(doc.id);
  });

  it("lead CSV export (full contact details) is refused", async () => {
    const res = await exportLeads();
    expect(res.status).toBe(403);
  });

  it("the owner can still log in and gets full access", async () => {
    process.env.ADMIN_PASSWORD = "correct horse battery staple";
    expect(await adminAccess()).toBe("readonly");
    expect(await run(actions.login, fd({ password: "wrong" }))).toBe("/admin/login?error=1");
    expect(await adminAccess()).toBe("readonly");
    await createSession();
    expect(await adminAccess()).toBe("full");
    const res = await exportLeads();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ayse.demir@example.com");
  });
});

describe("without PUBLIC_DEMO the same actions still work (the guard is not vacuous)", () => {
  it("local open demo can resolve an unanswered question", async () => {
    expect(await adminAccess()).toBe("full");
    await run(actions.setUnansweredResolved, fd({ ids: "q-1", resolved: "1" }));
    const q = (await (await getStore()).listUnanswered(DEMO_ASSISTANT_ID)).find((x) => x.id === "q-1");
    expect(q?.resolved).toBe(true);
    await run(actions.setUnansweredResolved, fd({ ids: "q-1", resolved: "0" }));
  });

  it("a private deployment sends strangers to the login page", async () => {
    process.env.ADMIN_PASSWORD = "secret";
    expect(await adminAccess()).toBe("none");
    expect(await run(actions.deleteLead, fd({ id: "lead-1" }))).toBe("/admin/login");
    expect((await exportLeads()).status).toBe(401);
  });
});

describe("visitor data is masked on the public panel", () => {
  it("masks e-mail, phone and names", () => {
    expect(maskEmail("ayse.demir@example.com")).toBe("a****@e****.com");
    expect(maskPhone("0532 123 45 67")).toBe("*********67");
    expect(maskPhone("+90 532 123 45 67")).toBe("+**********67");
    expect(maskName("Ayşe Demir")).toBe("A*** D****");
    expect(maskContact("ayse@example.com")).toBe("a***@e****.com");
    expect(maskContact("05321234567")).toBe("*********67");
  });

  it("redacts contact details inside free text but keeps prices and years", () => {
    const out = redactPII("Beni 0532 123 45 67 veya ayse@example.com üzerinden arayın. Fiyat 6.500 TL, 2026.");
    expect(out).not.toMatch(/0532|123 45|ayse@/);
    expect(out).toContain("*********67");
    expect(out).toContain("a***@e****.com");
    expect(out).toContain("6.500 TL");
    expect(out).toContain("2026");
  });
});
