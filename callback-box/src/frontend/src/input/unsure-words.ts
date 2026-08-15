/**
 * In-place `<unsure>` marking of low-confidence transcript words (Track 3,
 * docs/plans/transcript-confidence.md — Vocabulary lock-ins). Pure function:
 * no alignment against a separate metadata channel, no score in the output
 * — `<unsure>word</unsure>` wraps the word where it sits in the sent body.
 */

import type { FinalWord } from "../machines/transcription-events";

/**
 * Confidence threshold below which a word gets wrapped in `<unsure>`. Named
 * per the plan's Vocabulary lock-ins section: measured against the
 * production batch call over 11 dictation recordings (642 words) — 0.85
 * caught every observed transcription error ("cloud" for *Claude* at
 * 0.29/0.76, "can" for *can't* at 0.52, a "worked" mishearing at 0.48,
 * "Anthropix" for *Anthropic's* at 0.82) while passing confident proper
 * nouns unmarked (Minneapolis 0.999, Bicking 0.926). See docs/plans/
 * transcript-confidence.md, "Measurement basis". Not user-configurable.
 */
export const UNSURE_THRESHOLD = 0.85;

/**
 * Map a raw realtime-words snapshot onto what an emission is allowed to
 * carry. Two collapses onto "no data" (`undefined`), never a false
 * `stt="deepgram"` claim:
 *  - `null`/`undefined` — the capturing service reported nothing (Voxtral,
 *    OpenAI realtime, or a segment the machine never attached words to).
 *  - a defined array where NO entry carries a numeric `confidence` —
 *    belt-and-braces for a future Deepgram response that omits it; an
 *    all-absent-confidence array is exactly as uninformative as no array.
 */
export function resolveEmissionWords(
  words: readonly FinalWord[] | null | undefined,
): readonly FinalWord[] | undefined {
  if (words === null || words === undefined) {
    return undefined;
  }
  const hasConfidence = words.some((word) => typeof word.confidence === "number");
  return hasConfidence ? words : undefined;
}

interface BodyToken {
  start: number;
  end: number;
  leading: string;
  core: string;
  trailing: string;
  /** "" for a `<...>` control-markup span — never matches any real word. */
  norm: string;
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

function isSpace(ch: string): boolean {
  return /\s/.test(ch);
}

/**
 * Split a non-tag token into its outer punctuation and inner word core.
 * Internal punctuation (an apostrophe in "they're") stays in the core, since
 * that's the substring `markUnsureWords` wraps — only the LEADING/TRAILING
 * punctuation is kept outside the `<unsure>` tag.
 */
function splitToken(token: string): { leading: string; core: string; trailing: string } {
  let start = 0;
  while (start < token.length && !isWordChar(token[start] ?? "")) {
    start += 1;
  }
  let end = token.length - 1;
  while (end >= start && !isWordChar(token[end] ?? "")) {
    end -= 1;
  }
  if (start > end) {
    return { leading: token, core: "", trailing: "" };
  }
  return { leading: token.slice(0, start), core: token.slice(start, end + 1), trailing: token.slice(end + 1) };
}

/** Lowercase, strip every non-letter/digit character (Unicode-aware) — the comparison key both sides normalize to. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Tokenize `body` on whitespace, EXCEPT that a `<...>` span (control markup
 * this codebase generates itself — `<send-message phrase="…" />`,
 * `<user-selection>`) is scanned as one opaque token from `<` through its
 * matching `>`, whitespace and all, with an empty core: it can never be
 * matched (so a stream word like "message" can't land inside `phrase="send
 * message"`) and never wrapped. Dictated text can't contain a literal `<`,
 * so this never mis-fires on real speech.
 */
function tokenizeBody(body: string): BodyToken[] {
  const tokens: BodyToken[] = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === undefined) break;
    if (isSpace(ch)) {
      i += 1;
      continue;
    }
    if (ch === "<") {
      const close = body.indexOf(">", i + 1);
      const end = close === -1 ? body.length : close + 1;
      tokens.push({ start: i, end, leading: body.slice(i, end), core: "", trailing: "", norm: "" });
      i = end;
      continue;
    }
    let j = i;
    while (j < body.length) {
      const c = body[j];
      if (c === undefined || isSpace(c) || c === "<") break;
      j += 1;
    }
    const raw = body.slice(i, j);
    const { leading, core, trailing } = splitToken(raw);
    tokens.push({ start: i, end: j, leading, core, trailing, norm: normalize(core) });
    i = j;
  }
  return tokens;
}

/**
 * Which body-token indices to wrap: a forward-only, order-preserving scan of
 * `words` against `tokens`, never starting before `spokenStart` (a prior
 * typed-composer prefix the words stream doesn't describe — Track 3 review
 * fix). Each words-stream entry searches from the last matched position
 * onward for the next unconsumed token with a matching normalized core; the
 * cursor then advances past it, so a token is never matched twice and
 * matches stay in spoken order. A word that can't be found ahead of the
 * cursor — the typed prefix, a keyword-stripped tail, a repeat the body
 * dropped — is left unmatched: fail-open per word, since a marker on the
 * wrong word is worse than none. Repeated words are naturally disambiguated
 * by this order; a repeat the body doesn't have enough occurrences of has no
 * home for its second entry and is skipped the same way. Control-markup
 * tokens (`norm === ""`) never match, since `normalize(word.word)` is never
 * empty for a real spoken word.
 */
function findMarkedIndices(
  tokens: readonly BodyToken[],
  opts: { words: readonly FinalWord[]; spokenStart: number },
): Set<number> {
  const { words, spokenStart } = opts;
  const marked = new Set<number>();
  let cursor = 0;
  while (cursor < tokens.length && (tokens[cursor]?.start ?? spokenStart) < spokenStart) {
    cursor += 1;
  }
  for (const word of words) {
    const norm = normalize(word.word);
    if (norm === "") {
      continue;
    }
    let found = -1;
    for (let j = cursor; j < tokens.length; j += 1) {
      if (tokens[j]?.norm === norm) {
        found = j;
        break;
      }
    }
    if (found === -1) {
      continue;
    }
    cursor = found + 1;
    if (typeof word.confidence === "number" && word.confidence < UNSURE_THRESHOLD) {
      marked.add(found);
    }
  }
  return marked;
}

/**
 * Wrap low-confidence words in `body` with `<unsure>…</unsure>`, in place.
 * `body` is returned byte-identical when `words` is empty or nothing
 * cleared the threshold — callers can call this unconditionally once
 * `words` is known to be defined (see `Emission.words`/`stt` semantics in
 * `chat-assemble.ts`).
 *
 * `spokenStart` (default 0) is the char offset in `body` where the spoken
 * portion begins — everything before it (typed composer text prepended
 * ahead of a keyword-fire or stop-and-send) is never a match target, even
 * if a low-confidence stream word happens to normalize the same way.
 */
export function markUnsureWords(
  body: string,
  opts: { words: readonly FinalWord[]; spokenStart?: number },
): string {
  const spokenStart = opts.spokenStart ?? 0;
  const tokens = tokenizeBody(body);
  const marked = findMarkedIndices(tokens, { words: opts.words, spokenStart });
  if (marked.size === 0) {
    return body;
  }
  let result = "";
  let lastEnd = 0;
  for (const [i, token] of tokens.entries()) {
    result += body.slice(lastEnd, token.start);
    const wrappedCore = marked.has(i) ? `<unsure>${token.core}</unsure>` : token.core;
    result += token.leading + wrappedCore + token.trailing;
    lastEnd = token.end;
  }
  result += body.slice(lastEnd);
  return result;
}
