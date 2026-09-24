/**
 * AI Support Assistant — embeddable chat widget.
 *
 *   <script src="https://YOUR-APP/widget.js" data-assistant="ASSISTANT_ID" async></script>
 *
 * Optional attributes: data-lang="tr|en", data-position="right|left", data-open="true".
 * Everything renders inside a Shadow DOM, so host-page CSS can't leak in and ours can't leak out.
 * All text is inserted with textContent (never innerHTML).
 */

type Lang = "tr" | "en";

interface WidgetConfig {
  id: string;
  name: string;
  businessName: string;
  names?: Record<Lang, { name: string; businessName: string }>;
  color: string;
  welcome: Record<Lang, string>;
}

interface Source {
  documentTitle: string;
  heading: string;
  snippet: string;
}

interface ChatResponse {
  conversationId: string;
  answer: string;
  answered: boolean;
  handoff: boolean;
  sources: Source[];
}

const T: Record<Lang, Record<string, string>> = {
  tr: {
    open: "Sohbeti aç",
    close: "Kapat",
    placeholder: "Sorunuzu yazın…",
    send: "Gönder",
    source: "Kaynak",
    typing: "Yazıyor…",
    rate: "Çok hızlı soru gönderiyorsunuz, lütfen biraz bekleyin.",
    daily: "Asistan bugün için yoğun. Lütfen daha sonra tekrar deneyin.",
    tooLong: "Sorunuz çok uzun, lütfen kısaltın.",
    error: "Bir hata oluştu. Lütfen tekrar deneyin.",
    leadTitle: "Yetkiliye iletelim",
    name: "Adınız",
    contact: "E-posta veya telefon",
    consent: "İletişim bilgilerimin bu talep için işletmeyle paylaşılmasına ve bana dönüş yapılmasına izin veriyorum (KVKK).",
    submit: "Gönder",
    leadOk: "Teşekkürler! Bilgileriniz iletildi, en kısa sürede size dönüş yapılacak.",
    leadInvalid: "Lütfen adınızı ve geçerli bir e-posta/telefon girin, onay kutusunu işaretleyin.",
    powered: "Yalnızca işletmenin bilgi tabanından yanıt verir",
  },
  en: {
    open: "Open chat",
    close: "Close",
    placeholder: "Type your question…",
    send: "Send",
    source: "Source",
    typing: "Typing…",
    rate: "You're sending questions too fast, please wait a moment.",
    daily: "The assistant is busy today. Please try again later.",
    tooLong: "Your question is too long, please shorten it.",
    error: "Something went wrong. Please try again.",
    leadTitle: "Let our team get back to you",
    name: "Your name",
    contact: "Email or phone",
    consent: "I agree that my contact details are shared with the business for this request so they can contact me.",
    submit: "Send",
    leadOk: "Thank you! Your details were sent and the team will contact you shortly.",
    leadInvalid: "Please enter your name, a valid email/phone and tick the consent box.",
    powered: "Answers only from the business's knowledge base",
  },
};

const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.launcher { position: fixed; bottom: 20px; width: 58px; height: 58px; border-radius: 50%; border: 0; cursor: pointer;
  background: var(--c); color: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.22); display: grid; place-items: center;
  transition: transform .15s ease; z-index: 2147483000; }
.launcher:hover { transform: scale(1.06); }
.launcher:focus-visible, button:focus-visible, textarea:focus-visible, input:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px; }
.launcher svg { width: 28px; height: 28px; }
.right { right: 20px; } .left { left: 20px; }
.panel { position: fixed; bottom: 90px; width: 380px; max-width: calc(100vw - 32px); height: 580px; max-height: calc(100vh - 120px);
  background: #fff; color: #111827; border-radius: 16px; box-shadow: 0 12px 48px rgba(0,0,0,.25); display: none;
  flex-direction: column; overflow: hidden; z-index: 2147483001; font-size: 14px; line-height: 1.45; }
.panel.open { display: flex; }
header { background: var(--c); color: #fff; padding: 14px 16px; display: flex; align-items: center; gap: 10px; }
header .t { flex: 1; min-width: 0; }
header .n { font-weight: 650; font-size: 15px; }
header .b { font-size: 12px; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.x { background: transparent; border: 0; color: #fff; font-size: 24px; line-height: 1; cursor: pointer; padding: 4px 8px; border-radius: 8px; }
.log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: #f8fafc; }
.m { max-width: 85%; padding: 9px 12px; border-radius: 14px; white-space: pre-wrap; word-wrap: break-word; }
.u { align-self: flex-end; background: var(--c); color: #fff; border-bottom-right-radius: 4px; }
.a { align-self: flex-start; background: #fff; border: 1px solid #e5e7eb; border-bottom-left-radius: 4px; }
.typing { color: #6b7280; font-style: italic; }
details { margin-top: 8px; font-size: 12px; color: #4b5563; border-top: 1px dashed #e5e7eb; padding-top: 6px; }
summary { cursor: pointer; color: var(--c); font-weight: 600; }
details p { margin: 6px 0 0; white-space: pre-wrap; }
details .h { font-weight: 600; color: #111827; }
form.lead { align-self: stretch; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
form.lead .lt { font-weight: 650; }
form.lead input[type=text] { border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 10px; font-size: 14px; width: 100%; }
form.lead label { font-size: 12px; color: #4b5563; display: flex; gap: 6px; align-items: flex-start; }
form.lead .err { color: #b91c1c; font-size: 12px; }
.btn { background: var(--c); color: #fff; border: 0; border-radius: 8px; padding: 9px 14px; font-weight: 600; cursor: pointer; font-size: 14px; }
.btn:disabled { opacity: .6; cursor: default; }
.composer { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e5e7eb; background: #fff; }
textarea { flex: 1; resize: none; border: 1px solid #d1d5db; border-radius: 10px; padding: 9px 10px; font-size: 14px; height: 40px; max-height: 96px; }
.foot { font-size: 11px; color: #9ca3af; text-align: center; padding: 0 10px 8px; background: #fff; }
@media (max-width: 480px) {
  .panel { inset: 0; width: 100%; max-width: 100%; height: 100%; max-height: 100%; border-radius: 0; bottom: 0; }
  .panel.open ~ .launcher { display: none; }
}
@media (prefers-reduced-motion: reduce) { .launcher { transition: none; } }
`;

const ICON_CHAT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function safeStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

(function init() {
  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>("script[data-assistant]");
  if (!script) return;
  const assistantId = script.dataset.assistant ?? "";
  if (!assistantId || (window as unknown as { __aisaLoaded?: boolean }).__aisaLoaded) return;
  (window as unknown as { __aisaLoaded?: boolean }).__aisaLoaded = true;

  const base = new URL(script.src, location.href).origin;
  const position = script.dataset.position === "left" ? "left" : "right";
  const pageLang = (script.dataset.lang || document.documentElement.lang || navigator.language || "tr").slice(0, 2);
  let lang: Lang = pageLang === "en" ? "en" : "tr";
  const storeKey = `aisa:${assistantId}:conversation`;
  let conversationId = safeStorage()?.getItem(storeKey) ?? undefined;

  const host = document.createElement("div");
  host.setAttribute("data-ai-support-assistant", "");
  const root = host.attachShadow({ mode: "open" });
  const style = el("style");
  style.textContent = STYLES;
  root.appendChild(style);

  const panel = el("div", { class: `panel ${position}`, role: "dialog", "aria-modal": "false" });
  const header = el("header");
  const titles = el("div", { class: "t" });
  const nameEl = el("div", { class: "n" });
  const bizEl = el("div", { class: "b" });
  titles.append(nameEl, bizEl);
  const closeBtn = el("button", { class: "x", type: "button" }, "×");
  header.append(titles, closeBtn);
  const log = el("div", { class: "log", role: "log", "aria-live": "polite" });
  const composer = el("form", { class: "composer" });
  const input = el("textarea", { rows: "1", maxlength: "500" });
  const sendBtn = el("button", { class: "btn", type: "submit" });
  composer.append(input, sendBtn);
  const foot = el("div", { class: "foot" });
  panel.append(header, log, composer, foot);

  const launcher = el("button", { class: `launcher ${position}`, type: "button", "aria-expanded": "false" });
  launcher.innerHTML = ICON_CHAT; // static, trusted SVG
  root.append(panel, launcher);

  let config: WidgetConfig | null = null;
  let welcomed = false;
  let busy = false;

  function applyLang() {
    const t = T[lang];
    launcher.setAttribute("aria-label", t.open);
    closeBtn.setAttribute("aria-label", t.close);
    input.placeholder = t.placeholder;
    sendBtn.textContent = t.send;
    foot.textContent = t.powered;
    // older servers only send name/businessName; newer ones send per-language names
    const names = config?.names?.[lang] ?? (config ? { name: config.name, businessName: config.businessName } : null);
    if (names) {
      nameEl.textContent = names.name;
      bizEl.textContent = names.businessName;
    }
    panel.setAttribute("aria-label", names?.name ?? t.open);
  }

  function scroll() {
    log.scrollTop = log.scrollHeight;
  }

  function addUser(text: string) {
    log.appendChild(el("div", { class: "m u" }, text));
    scroll();
  }

  function addAssistant(text: string, sources: Source[] = []) {
    const m = el("div", { class: "m a" }, text);
    for (const s of sources) {
      const d = el("details");
      d.appendChild(el("summary", {}, `${T[lang].source}: ${s.documentTitle}`));
      const p = el("p");
      p.appendChild(el("span", { class: "h" }, `${s.heading}\n`));
      p.appendChild(document.createTextNode(s.snippet));
      d.appendChild(p);
      m.appendChild(d);
    }
    log.appendChild(m);
    scroll();
  }

  function addLeadForm(question: string) {
    const t = T[lang];
    const f = el("form", { class: "lead", novalidate: "" });
    f.appendChild(el("div", { class: "lt" }, t.leadTitle));
    const name = el("input", { type: "text", autocomplete: "name", maxlength: "80", "aria-label": t.name, placeholder: t.name });
    const contact = el("input", { type: "text", autocomplete: "email", maxlength: "120", "aria-label": t.contact, placeholder: t.contact });
    const label = el("label");
    const consent = el("input", { type: "checkbox" });
    label.append(consent, document.createTextNode(t.consent));
    const err = el("div", { class: "err", role: "alert" });
    const btn = el("button", { class: "btn", type: "submit" }, t.submit);
    f.append(name, contact, label, err, btn);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.textContent = "";
      if (!name.value.trim() || !contact.value.trim() || !consent.checked) {
        err.textContent = t.leadInvalid;
        return;
      }
      btn.disabled = true;
      try {
        const res = await fetch(`${base}/api/leads`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            assistantId,
            conversationId,
            name: name.value,
            contact: contact.value,
            question,
            lang,
            consent: true,
          }),
        });
        if (res.status === 400) {
          err.textContent = t.leadInvalid;
          btn.disabled = false;
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        f.replaceWith(el("div", { class: "m a" }, t.leadOk));
      } catch {
        err.textContent = t.error;
        btn.disabled = false;
      }
    });
    log.appendChild(f);
    scroll();
    name.focus();
  }

  async function loadConfig() {
    if (config) return;
    const res = await fetch(`${base}/api/widget/config?assistant=${encodeURIComponent(assistantId)}`);
    if (!res.ok) throw new Error(String(res.status));
    config = (await res.json()) as WidgetConfig;
    host.style.setProperty("--c", config.color);
    applyLang();
  }

  async function open() {
    panel.classList.add("open");
    launcher.setAttribute("aria-expanded", "true");
    try {
      await loadConfig();
    } catch {
      addAssistant(T[lang].error);
      return;
    }
    if (!welcomed && config) {
      welcomed = true;
      addAssistant(config.welcome[lang]);
    }
    input.focus();
  }

  function close() {
    panel.classList.remove("open");
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  }

  async function send(text: string) {
    if (busy) return;
    busy = true;
    sendBtn.disabled = true;
    addUser(text);
    const typing = el("div", { class: "m a typing" }, T[lang].typing);
    log.appendChild(typing);
    scroll();
    try {
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assistantId, message: text, conversationId, lang }),
      });
      typing.remove();
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        addAssistant(body.error === "daily_limit" ? T[lang].daily : T[lang].rate);
        return;
      }
      if (res.status === 400) {
        addAssistant(T[lang].tooLong);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as ChatResponse;
      conversationId = data.conversationId;
      safeStorage()?.setItem(storeKey, conversationId);
      addAssistant(data.answer, data.sources);
      if (data.handoff) addLeadForm(text);
    } catch {
      typing.remove();
      addAssistant(T[lang].error);
    } finally {
      busy = false;
      sendBtn.disabled = false;
    }
  }

  launcher.addEventListener("click", () => (panel.classList.contains("open") ? close() : open()));
  closeBtn.addEventListener("click", close);
  root.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") close();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });
  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    void send(text);
  });

  host.style.setProperty("--c", "#0d9488");
  applyLang();
  if (document.body) document.body.appendChild(host);
  else document.addEventListener("DOMContentLoaded", () => document.body.appendChild(host));

  (window as unknown as { AISupportAssistant: unknown }).AISupportAssistant = {
    open,
    close,
    setLang(next: Lang) {
      lang = next === "en" ? "en" : "tr";
      applyLang();
      log.replaceChildren();
      welcomed = false;
      if (panel.classList.contains("open") && config) {
        welcomed = true;
        addAssistant(config.welcome[lang]);
      }
    },
    /** Opens the panel and sends a question (used by the "try it" preview's suggested questions). */
    async ask(text: string) {
      await open();
      const q = String(text ?? "").trim().slice(0, 500);
      if (q) await send(q);
    },
  };

  if (script.dataset.open === "true") void open();
})();
export {};
