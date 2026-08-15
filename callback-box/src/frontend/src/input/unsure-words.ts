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

interface BodyToken {
  start: number;
  end: number;
  leading: string;
  core: string;
  trailing: string;
  norm: string;
}

function isWordChar(ch: string): boolean {
  return /[\da-z]/i.test(ch);
}

/**
 * Split a whitespace token into its outer punctuation and inner word core.
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

/** Lowercase, strip every non-alphanumeric character — the comparison key both sides normalize to. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\da-z]/g, "");
}

function tokenizeBody(body: string): BodyToken[] {
  const tokens: BodyToken[] = [];
  const wordRe = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = wordRe.exec(body)) !== null) {
    const { leading, core, trailing } = splitToken(match[0]);
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      leading, core, trailing,
      norm: normalize(core),
    });
  }
  return tokens;
}

/**
 * Which body-token indices to wrap: a forward-only, order-preserving scan of
 * `words` against `tokens`. Each words-stream entry searches from the last
 * matched position onward for the next unconsumed token with a matching
 * normalized core; the cursor then advances past it, so a token is never
 * matched twice and matches stay in spoken order. A word that can't be
 * found ahead of the cursor — a prior typed prefix the words stream never
 * covered, a keyword-stripped tail, a repeat the body dropped — is left
 * unmatched: fail-open per word, since a marker on the wrong word is worse
 * than none. Repeated words are naturally disambiguated by this order; a
 * repeat the body doesn't have enough occurrences of has no home for its
 * second entry and is skipped the same way.
 */
function findMarkedIndices(tokens: readonly BodyToken[], words: readonly FinalWord[]): Set<number> {
  const marked = new Set<number>();
  let cursor = 0;
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
 */
export function markUnsureWords(body: string, words: readonly FinalWord[]): string {
  const tokens = tokenizeBody(body);
  const marked = findMarkedIndices(tokens, words);
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
