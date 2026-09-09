/**
 * Soft format hints for secret entry (`docs/implemented-plans/secret-custody.md`, "Guided
 * entry + validation").
 *
 * WARN, NEVER BLOCK. Provider key formats drift — a prefix change at the
 * provider would brick key entry if the format were a gate — so everything here
 * produces a sentence for the boxholder to read and override, and nothing here
 * can refuse a save. The heuristics are deliberately loose for the same reason:
 * they catch "you pasted the wrong thing entirely" (an email address, a URL, a
 * truncated paste), not "this is character-for-character the current shape".
 *
 * These are the SERVER's own entries. An agent may name one through an entry's
 * `formatHint` (a registry key, or free prose shown as-is), but an agent can
 * never add a rule here and can never affect whether a save succeeds.
 */

import { lookupByName } from "./name-match.js";

/** One provider's shape, all parts optional — a hint may be prose alone. */
interface SecretFormat {
  /** One-line description of what a well-formed value looks like. */
  hint: string;
  prefix?: string;
  minLength?: number;
  maxLength?: number;
  /** Literal, server-authored — never built from a name or an agent's hint. */
  pattern?: RegExp;
}

/**
 * A registry entry as the admin UI receives it. The `pattern` deliberately does
 * NOT cross the wire: the UI would have to build a `RegExp` from a string to
 * use it, and the value is only ever a hint anyway — the hint sentence carries
 * the same information in a form a person can read, and the authoritative
 * warnings come back from the save.
 */
export interface SecretFormatEntry {
  key: string;
  hint: string;
  prefix: string | undefined;
  minLength: number | undefined;
  maxLength: number | undefined;
}

/**
 * Keyed by store name, or by a `family/` prefix for per-box instances. Values
 * that hold several fields are stored as a JSON string the consumer parses
 * (`json-secret.ts`), so their hint describes the JSON, not a bare key.
 */
const secretFormats: Record<string, SecretFormat> = {
  mistral: { hint: "A Mistral API key — one long token, no spaces.", minLength: 16, maxLength: 200 },
  openai: { hint: "An OpenAI API key, starting with `sk-`.", prefix: "sk-", minLength: 20, maxLength: 300 },
  "openai-thinking": {
    hint: "The OpenAI key used for chat/thinking, starting with `sk-`.",
    prefix: "sk-",
    minLength: 20,
    maxLength: 300,
  },
  anthropic: { hint: "An Anthropic API key, starting with `sk-ant-`.", prefix: "sk-ant-", minLength: 20, maxLength: 300 },
  gemini: { hint: "A Google AI Studio key, usually starting with `AIza`.", prefix: "AIza", minLength: 20, maxLength: 200 },
  deepgram: {
    hint: 'JSON with the management key and project: {"apiKey": "…", "projectId": "…"}.',
    pattern: /^{/,
    minLength: 20,
  },
  "google-oauth-client-id": {
    hint: "The OAuth client id, ending in `.apps.googleusercontent.com`.",
    pattern: /\.apps\.googleusercontent\.com$/,
    minLength: 20,
  },
  "google-oauth-client-secret": { hint: "The OAuth client secret — one token, no spaces.", minLength: 10, maxLength: 200 },
  "telegram-bot/": {
    hint: 'JSON holding the bot token and webhook secret: {"botToken": "123456:…", "webhookSecret": "…"}. Normally written by the Telegram section, not by hand.',
    pattern: /^{/,
    minLength: 20,
  },
  "publish/": {
    hint: 'JSON holding the R2 credentials: {"accountId": "…", "bucket": "…", "apiToken": "…"}. Normally written by `bbx pub setup`.',
    pattern: /^{/,
    minLength: 20,
  },
};

function toEntry(key: string, format: SecretFormat): SecretFormatEntry {
  return {
    key,
    hint: format.hint,
    prefix: format.prefix,
    minLength: format.minLength,
    maxLength: format.maxLength,
  };
}

/** Every entry, key-sorted — what the admin UI fetches once and matches locally. */
export function listSecretFormats(): SecretFormatEntry[] {
  return Object.entries(secretFormats)
    .map(([key, format]) => toEntry(key, format))
    .toSorted((a, b) => a.key.localeCompare(b.key));
}

function formatFor(opts: { name: string; formatHint: string | undefined }): { key: string; entry: SecretFormat } | null {
  if (opts.formatHint !== undefined) {
    const hinted = secretFormats[opts.formatHint];
    if (hinted !== undefined) return { key: opts.formatHint, entry: hinted };
  }
  return lookupByName(secretFormats, opts.name);
}

/**
 * Check a value against its format. Returns the warnings to SHOW, never a
 * verdict to act on — an empty array means "nothing looks off", and a non-empty
 * one still saves if the boxholder proceeds.
 */
export function secretFormatWarnings(opts: { name: string; value: string; formatHint?: string | undefined }): string[] {
  const found = formatFor({ name: opts.name, formatHint: opts.formatHint });
  if (found === null) return [];
  const format = found.entry;
  const warnings: string[] = [];
  if (opts.value !== opts.value.trim()) {
    warnings.push("The value has leading or trailing whitespace — usually an artifact of copy-paste.");
  }
  const trimmed = opts.value.trim();
  if (format.prefix !== undefined && !trimmed.startsWith(format.prefix)) {
    warnings.push(`Keys for this service usually start with "${format.prefix}".`);
  }
  if (format.minLength !== undefined && trimmed.length < format.minLength) {
    warnings.push(`This looks short (${trimmed.length} characters) — a truncated paste?`);
  }
  if (format.maxLength !== undefined && trimmed.length > format.maxLength) {
    warnings.push(`This looks long (${trimmed.length} characters) — did extra text come along?`);
  }
  if (format.pattern !== undefined && !format.pattern.test(trimmed)) {
    warnings.push(format.hint);
  }
  return warnings;
}
