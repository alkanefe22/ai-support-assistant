import { adminAccess } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { currentAssistant } from "../../../current";

/** Quotes a CSV cell and defuses spreadsheet formula injection (=, +, -, @). */
function cell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET() {
  const access = await adminAccess();
  if (access === "none") return new Response("Unauthorized", { status: 401 });
  // full contact details must never leave a public read-only demo
  if (access === "readonly") return new Response("Read-only demo: export disabled", { status: 403 });
  const { assistant } = await currentAssistant();
  const leads = await (await getStore()).listLeads(assistant.id);
  const rows = [
    ["created_at", "name", "contact", "question", "lang"],
    ...leads.map((l) => [l.createdAt, l.name, l.contact, l.question, l.lang]),
  ];
  const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads-${assistant.id}.csv"`,
      "cache-control": "no-store",
    },
  });
}
