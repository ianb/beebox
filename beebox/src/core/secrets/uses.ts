/**
 * Why a secret exists: the built-in half of "used for"
 * (`docs/secrets.md`, "Why a secret exists").
 *
 * A grant is a decision, and a decision needs a reason. `note` was never it —
 * it is one free-text line the boxholder wrote once, usually at 2am while
 * pasting a key. The reasons here are DERIVED FROM WHAT THE READERS DO: every
 * line below corresponds to a `resolveSecret` call site in this repo, so the
 * boxholder sees what the engine will actually spend the key on before granting
 * it, and afterwards can tell whether a grant still earns its keep.
 *
 * **Additive, not exclusive.** One key usually serves several purposes (an
 * OpenAI key does speech, transcription, and realtime), which is why every value
 * is a LIST. The deferred alternative — one key per purpose — is a different
 * feature; this one describes the key that exists.
 *
 * Three sources feed a display, and they are kept apart rather than merged into
 * one blur:
 *
 * - **built-in** (here) — what the engine's own readers do. Server-owned: an
 *   agent cannot add a line here, the same rule the probe registry runs on.
 * - **declared** (`entry.uses`) — what a boxholder or agent said, for ad-hoc
 *   secrets the engine knows nothing about, and for extra reasons on a
 *   built-in one.
 * - **observed** (`entry.purposes`) — the distinct `purpose` labels real
 *   resolves actually passed. This is the one that can contradict the other
 *   two, which is exactly why it is shown separately: a secret nobody claims to
 *   use but something resolves hourly is worth a look.
 *
 * Keyed like the probe and format registries — exact name, or a `family/`
 * prefix for per-box instances — through the shared `name-match.ts` lookup.
 */

import {
  InvalidSecretUseError,
  SecretNotFoundError,
  SecretUseNotFoundError,
  TooManySecretUsesError,
} from "./errors.js";
import { lookupByName } from "./name-match.js";
import { mutateSecretStore } from "./store.js";

/**
 * What the engine's readers spend each secret on. Every entry is checkable
 * against a call site; nothing here is aspirational, and a name with no entry
 * has no built-in reasons rather than a guessed one.
 */
const builtinUses: Record<string, string[]> = {
  mistral: [
    "audio transcription (Voxtral — recordings and live chat dictation)",
    "Mistral API calls from box views, through the server-side adapter",
  ],
  openai: [
    "embeddings for semantic and hybrid card search",
    "OpenAI API calls from box views, through the server-side adapter",
  ],
  "openai-thinking": [
    "speech generation for chat (text-to-speech)",
    "audio transcription (Whisper)",
    "minting short-lived realtime-transcription keys for the browser",
  ],
  gemini: [
    "answering questions about a voice recording (`bbx chat ask-about-audio`)",
    "describing scanned images, when scan import is set to the Gemini vision backend",
  ],
  deepgram: [
    "audio transcription of recordings",
    "minting short-lived transcription keys for the browser (the stored key is the management key and never leaves the server)",
  ],
  anthropic: [
    "Anthropic API calls from box views, through the server-side adapter (the agent itself uses subscription auth, not this key)",
  ],
  replicate: ["Replicate model calls from box views, through the server-side adapter"],
  openrouter: [
    "embeddings for semantic and hybrid card search, when the box has no OpenAI key",
    "answering questions about recordings, and describing scanned images when the Gemini scan backend is selected, when the box has no Gemini key",
    "the Whisper high-quality transcription pass, when the box has no OpenAI key",
    "the MAI-Transcribe-2 high-quality transcription pass, which is reachable no other way",
    "speech generation for chat, when the box's TTS backend is set to Gemini",
    "OpenRouter API calls from box views, through the server-side adapter",
  ],
  "google-oauth-client-id": [
    "the Google OAuth application's identity — the consent flow and token refresh behind Gmail, Calendar, Drive and Google sign-in",
  ],
  "google-oauth-client-secret": [
    "the Google OAuth application's identity — the consent flow and token refresh behind Gmail, Calendar, Drive and Google sign-in",
  ],
  "telegram-bot/": [
    "receiving this box's Telegram messages (the webhook secret authenticates Telegram's callbacks)",
    "sending notifications to the boxholder over Telegram",
  ],
  "publish/": ["reading reader submissions from this box's published-site R2 ingestion bucket"],
};

/** The three sources, kept apart — see the module comment. */
export interface SecretUses {
  /** From this registry: what the engine's own readers do with the secret. */
  builtin: string[];
  /** From the entry's `uses`: what a boxholder or agent said it is for. */
  declared: string[];
  /** From the entry's `purposes`: labels real resolves actually passed. */
  observed: string[];
}

/**
 * Every name the engine has a built-in reason for — the closed list the guide
 * registry must cover, and the one the add form offers. Family prefixes
 * (`telegram-bot/`) are included; callers that want typeable names filter on
 * the trailing slash.
 */
export function builtinSecretNames(): string[] {
  return Object.keys(builtinUses);
}

/** The built-in reasons for a name, or an empty list. */
export function builtinSecretUses(name: string): string[] {
  return lookupByName(builtinUses, name)?.entry ?? [];
}

/**
 * Everything known about why one secret exists. A declared reason that merely
 * repeats a built-in one is dropped — an agent re-declaring "audio
 * transcription" on `mistral` should not double the line — but nothing else is
 * de-duplicated across sources, since an observed label agreeing with a claim
 * is itself information.
 */
export function secretUsesFor(opts: {
  name: string;
  uses?: string[] | undefined;
  purposes?: string[] | undefined;
}): SecretUses {
  const builtin = builtinSecretUses(opts.name);
  const declared = (opts.uses ?? []).filter((use) => !builtin.includes(use));
  return { builtin, declared, observed: opts.purposes ?? [] };
}

/**
 * The three sources as printable lines, for `bbx secrets status` and anything
 * else writing them to a terminal. Each source is labelled rather than merged:
 * "the engine does this" and "an agent said this" and "this actually happened"
 * are different claims, and a reader deciding whether a grant still earns its
 * keep needs to tell them apart.
 */
export function formatSecretUsesLines(uses: SecretUses): string[] {
  const lines: string[] = [];
  if (uses.builtin.length > 0) lines.push(`used for: ${uses.builtin.join("; ")}`);
  if (uses.declared.length > 0) lines.push(`also declared: ${uses.declared.join("; ")}`);
  if (uses.observed.length > 0) lines.push(`observed: ${uses.observed.join(", ")}`);
  return lines;
}

/** One reason is one readable line — long enough for a clause, not a document. */
const MAX_USE_LENGTH = 200;

/** How many declared reasons one entry keeps. A list past this is not a list. */
const MAX_DECLARED_USES = 12;

/**
 * Clean and check reasons on their way into the store. Reasons are free prose
 * (a resolve `purpose` is the constrained label; this is the sentence a person
 * reads), so the only rules are the ones that keep the store and the admin page
 * readable: non-empty, one line, bounded.
 */
function normalizeUses(raw: string[]): string[] {
  const cleaned: string[] = [];
  for (const use of raw) {
    const trimmed = use.trim();
    if (trimmed === "") throw new InvalidSecretUseError({ detail: "it is empty" });
    if (/[\n\r]/.test(trimmed)) throw new InvalidSecretUseError({ detail: "it spans more than one line" });
    if (trimmed.length > MAX_USE_LENGTH) {
      throw new InvalidSecretUseError({
        detail: `it is ${trimmed.length} characters (the limit is ${MAX_USE_LENGTH})`,
      });
    }
    if (!cleaned.includes(trimmed)) cleaned.push(trimmed);
  }
  return cleaned;
}

/**
 * Fold new reasons into what an entry already carries — the additive rule, in
 * one place, so `declare`, `set` and `describe` cannot disagree about it. A
 * repeated reason is a no-op rather than a duplicate line, because an agent
 * re-running its own setup step must not grow the list every time.
 */
export function appendSecretUses(opts: {
  name: string;
  existing: string[] | undefined;
  added: string[] | undefined;
}): string[] | undefined {
  if (opts.added === undefined) return opts.existing;
  const merged = [...(opts.existing ?? [])];
  for (const use of normalizeUses(opts.added)) {
    if (merged.includes(use)) continue;
    if (merged.length >= MAX_DECLARED_USES) {
      throw new TooManySecretUsesError({ secretName: opts.name, limit: MAX_DECLARED_USES });
    }
    merged.push(use);
  }
  return merged.length === 0 ? undefined : merged;
}

/**
 * Say why a secret exists — the surface behind `bbx secrets describe`.
 *
 * ADDING is the agent-facing half and is deliberately unguarded, like
 * `declare`: an agent that teaches the box a new trick using an already-granted
 * key SHOULD append why, and a reason can neither disclose a value nor widen an
 * access level. REMOVING is the boxholder's — it deletes a record of what
 * something is for, and an agent quietly dropping the line that justified a
 * grant is the failure this feature exists to prevent — so the CLI puts the
 * agent guard on removal and clearing only.
 */
export async function describeSecret(opts: {
  name: string;
  addUses?: string[] | undefined;
  removeUses?: string[] | undefined;
  clearUses?: boolean | undefined;
}): Promise<{ uses: string[] }> {
  return mutateSecretStore({ purpose: "describe" }, (store) => {
    const entry = store.secrets[opts.name];
    if (entry === undefined) throw new SecretNotFoundError(opts.name);
    if (opts.clearUses === true) {
      entry.uses = undefined;
    }
    for (const use of opts.removeUses ?? []) {
      const remaining = (entry.uses ?? []).filter((existing) => existing !== use.trim());
      if (remaining.length === (entry.uses ?? []).length) {
        throw new SecretUseNotFoundError({ secretName: opts.name, use: use.trim() });
      }
      entry.uses = remaining.length === 0 ? undefined : remaining;
    }
    entry.uses = appendSecretUses({ name: opts.name, existing: entry.uses, added: opts.addUses });
    return { uses: entry.uses ?? [] };
  });
}
