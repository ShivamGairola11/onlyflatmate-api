// Synced from the web app (src/lib/validation/contact-info.ts) by scripts/sync-contract.mjs — do not edit here.
/**
 * Spots phone numbers and emails in free text, so people can't swap contact details
 * and skip the Contact Pass. Shared with the API (contract sync), which enforces it on
 * every user-written field; the web app uses it to warn while typing.
 */

const DIGIT_WORDS: Record<string, string> = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
const WORD = Object.keys(DIGIT_WORDS).join("|");

/** "nine eight double seven…" → "9 8 77…", so spelled-out numbers are caught like typed ones. */
function spellOut(text: string) {
  return text
    .toLowerCase()
    .replace(new RegExp(`\\b(double|triple)[\\s-]+(${WORD}|\\d)\\b`, "g"), (_, n: string, d: string) => (DIGIT_WORDS[d] ?? d).repeat(n === "double" ? 2 : 3))
    .replace(new RegExp(`\\b(${WORD})\\b`, "g"), (w) => DIGIT_WORDS[w]);
}

/** Runs of digits, allowing the separators people use to dodge filters: spaces, dashes, dots, brackets, commas. */
const DIGIT_RUN = /\+?\d(?:[\s\-.(),/]*\d){9,}/g;
const EMAIL = /[\w.+-]+\s*(?:@|\(at\)|\[at\])\s*[\w-]+\s*(?:\.|\(dot\)|\[dot\])\s*[a-z]{2,}/i;

/** An Indian mobile number: 10 digits starting 6–9, optionally after +91 / 91 / 0. */
function isMobile(digits: string) {
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  return local.length === 10 && /^[6-9]/.test(local);
}

export type ContactInfoKind = "PHONE" | "EMAIL";

export function findContactInfo(text: string | undefined | null): ContactInfoKind | null {
  if (!text) return null;
  for (const run of spellOut(text).match(DIGIT_RUN) ?? []) {
    const digits = run.replace(/\D/g, "");
    // A longer run can hide a number inside it ("call 9711889913 now 2" joined by separators).
    for (let i = 0; i + 10 <= digits.length; i++) if (isMobile(digits.slice(i, i + 12)) || isMobile(digits.slice(i, i + 10))) return "PHONE";
  }
  return EMAIL.test(text) ? "EMAIL" : null;
}

export const CONTACT_INFO_MESSAGE = "Phone numbers and emails can’t be shared here. Keep the conversation on Basera — it protects both of you.";
