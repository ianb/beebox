/**
 * Body tokenization + words-to-body matching for `unsure-words.ts`'s span
 * marking (Track 3, docs/implemented-plans/transcript-confidence.md). Split
 * out to keep `unsure-words.ts` under the file line budget — this module is
 * pure body-shape mechanics, no threshold/span logic.
 */

import type { FinalWord } from "../machines/transcription-events";

export interface BodyToken {
  start: number;
  end: number;
  /** Absolute char offset where the word core begins (after `leading`). */
  coreStart: number;
  /** Absolute char offset where the word core ends (before `trailing`). */
  coreEnd: number;
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
 * that's the substring a span wraps — only the LEADING/TRAILING punctuation
 * on the span's first/last token is kept outside the `<unsure>` tag.
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
 * message"`) and never wrapped, and a span can never contain or cross it.
 * Dictated text can't contain a literal `<`, so this never mis-fires on
 * real speech.
 */
export function tokenizeBody(body: string): BodyToken[] {
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
      tokens.push({ start: i, end, coreStart: i, coreEnd: end, leading: body.slice(i, end), core: "", trailing: "", norm: "" });
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
    tokens.push({
      start: i, end: j, leading, core, trailing,
      coreStart: i + leading.length, coreEnd: j - trailing.length,
      norm: normalize(core),
    });
    i = j;
  }
  return tokens;
}

/**
 * Match every word in `words` (not only low-confidence ones — a confident
 * word bridged between two spans still needs a body position) against
 * `tokens`, in order, never before `spokenStart` (a prior typed-composer
 * prefix the words stream doesn't describe — Track 3 review fix). Each
 * words-stream entry searches from the last matched position onward for
 * the next unconsumed token with a matching normalized core; the cursor
 * then advances past it, so a token is never matched twice and matches
 * stay in spoken order. Returns the matched token index per word, or
 * `null` when that word couldn't be found ahead of the cursor (the typed
 * prefix, a keyword-stripped tail, a repeat the body dropped) — fail-open,
 * since a marker on the wrong word is worse than none.
 */
export function matchWordsToTokens(
  tokens: readonly BodyToken[],
  opts: { words: readonly FinalWord[]; spokenStart: number },
): Array<number | null> {
  const { words, spokenStart } = opts;
  const matches: Array<number | null> = Array.from({ length: words.length }, () => null);
  let cursor = 0;
  while (cursor < tokens.length && (tokens[cursor]?.start ?? spokenStart) < spokenStart) {
    cursor += 1;
  }
  for (const [i, word] of words.entries()) {
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
    matches[i] = found;
  }
  return matches;
}
