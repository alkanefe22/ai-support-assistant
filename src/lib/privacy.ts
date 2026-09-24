/**
 * Masking for the public read-only panel: anyone can browse it, so visitor contact details
 * (leads, and anything typed into the chat) must not be shown in clear text.
 */

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
// 7+ digits with optional spaces, dots, dashes or parentheses, optionally starting with +
const PHONE = /\+?\d[\d\s().-]{5,}\d/g;

function starWord(w: string): string {
  const chars = [...w];
  return chars.length <= 1 ? "*" : `${chars[0]}${"*".repeat(Math.min(chars.length - 1, 4))}`;
}

export function maskEmail(email: string): string {
  const [user, domain = ""] = email.split("@");
  const parts = domain.split(".");
  const tld = parts.pop() ?? "";
  return `${starWord(user)}@${parts.map(starWord).join(".")}.${tld}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return phone;
  return `${phone.trim().startsWith("+") ? "+" : ""}${"*".repeat(digits.length - 2)}${digits.slice(-2)}`;
}

export function maskName(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(starWord).join(" ");
}

export function maskContact(contact: string): string {
  return contact.includes("@") ? maskEmail(contact) : maskPhone(contact);
}

/** Redacts e-mail addresses and phone numbers inside free text (chat messages, questions). */
export function redactPII(text: string): string {
  return text.replace(EMAIL, (m) => maskEmail(m)).replace(PHONE, (m) => maskPhone(m));
}
