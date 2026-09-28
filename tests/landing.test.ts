import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { siteUrl } from "@/lib/site";

const ENV = ["SITE_URL", "VERCEL_PROJECT_PRODUCTION_URL"] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.doUnmock("next/headers");
});

describe("siteUrl (the address in the install snippet)", () => {
  it("uses the Vercel production domain", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "ai-support-assistant-beta.vercel.app";
    expect(siteUrl("ai-support-assistant-byfoyx7ls-x.vercel.app")).toBe("https://ai-support-assistant-beta.vercel.app");
  });
  it("SITE_URL overrides it (custom domain)", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "ai-support-assistant-beta.vercel.app";
    process.env.SITE_URL = "https://destek.ornek.com/";
    expect(siteUrl()).toBe("https://destek.ornek.com");
  });
  it("falls back to the request host: http for localhost, https elsewhere", () => {
    expect(siteUrl("localhost:3100")).toBe("http://localhost:3100");
    expect(siteUrl("demo.example.com")).toBe("https://demo.example.com");
    expect(siteUrl(null)).toBe("http://localhost:3000");
  });
});

async function render(query: Record<string, string>) {
  vi.doMock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
  const { default: Home } = await import("@/app/page");
  return renderToStaticMarkup(await Home({ searchParams: Promise.resolve(query) }));
}

describe("landing page", () => {
  it("is English by default, with an EN/TR switch", async () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "ai-support-assistant-beta.vercel.app";
    const html = await render({});
    expect(html).toContain('lang="en"');
    expect(html).toContain("Answers with sources");
    expect(html).not.toContain("Kaynaklı cevap");
    const link = (label: string) => html.match(new RegExp(`<a [^>]*>${label}</a>`))?.[0] ?? "";
    expect(link("TR")).toContain('href="/?lang=tr"');
    expect(link("TR")).not.toContain("aria-current");
    expect(link("EN")).toContain('href="/"');
    expect(link("EN")).toContain('aria-current="page"');
  });

  it("the demo button goes to the English demo", async () => {
    const html = await render({});
    expect(html).toMatch(/href="\/demo\?lang=en"[^>]*>Open the demo site</);
  });

  it("the install snippet uses the real live address, never a placeholder", async () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "ai-support-assistant-beta.vercel.app";
    const html = await render({});
    expect(html).toContain("https://ai-support-assistant-beta.vercel.app/widget.js");
    expect(html).not.toContain("YOUR-DOMAIN");
  });

  it("?lang=tr gives the Turkish page, the Turkish demo and a Turkish snippet", async () => {
    const html = await render({ lang: "tr" });
    expect(html).toContain('lang="tr"');
    expect(html).toContain("Kaynaklı cevap");
    expect(html).toMatch(/href="\/demo"[^>]*>Demo siteyi aç</);
    expect(html).toContain("data-lang=&quot;tr&quot;");
  });

  it("an unknown language falls back to English", async () => {
    expect(await render({ lang: "de" })).toContain('lang="en"');
  });
});
