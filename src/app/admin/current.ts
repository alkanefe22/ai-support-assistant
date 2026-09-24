import { cookies } from "next/headers";
import { getStore } from "@/lib/store";
import type { AssistantSettings } from "@/lib/types";

export const CURRENT_COOKIE = "aisa_assistant";

/** The assistant the admin is currently managing (cookie, falling back to the first one). */
export async function currentAssistant(): Promise<{ assistant: AssistantSettings; all: AssistantSettings[] }> {
  const store = await getStore();
  // temporary "try it" assistants live on the Denemeler page, not in the assistant switcher
  const all = (await store.listAssistants()).filter((a) => !a.trial);
  if (all.length === 0) throw new Error("No assistants configured");
  const wanted = (await cookies()).get(CURRENT_COOKIE)?.value;
  return { assistant: all.find((a) => a.id === wanted) ?? all[0], all };
}
