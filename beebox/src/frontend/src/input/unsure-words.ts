/**
 * In-place `<unsure>` marking of low-confidence transcript PHRASE SPANS
 * (Track 3, docs/implemented-plans/transcript-confidence.md — Vocabulary
 * lock-ins; span rework, boxholder real-world-use feedback 2026-08-15).
 * Pure function: no alignment against a separate metadata channel, no
 * score in the output — `<unsure>…</unsure>` wraps the span where it sits
 * in the sent body.
 */

import type { FinalWord } from "../machines/transcription-events";
import { tokenizeBody, matchWordsToTokens, type BodyToken } from "./unsure-words-tokenize";

/**
 * Confidence threshold below which a word SEEDS an unsure span. Measured
 * against the production batch call over 11 dictation recordings (642
 * words) — see docs/implemented-plans/transcript-confidence.md,
 * "Measurement basis". Initially 0.85 (caught every observed error incl.
 * the borderline "Anthropix" 0.82 / "cloud" 0.76, at ~4.7 marks per long
 * dictation); lowered to 0.7 after real-world use (boxholder, 2026-08-15)
 * showed that mark rate too noisy — 0.7 keeps the clear catches ("cloud"
 * for *Claude* at 0.29, "can" for *can't* at 0.52, a "worked" mishearing
 * at 0.48) at roughly a third the marks. Not user-configurable. This is
 * the SEED cusp only — see `UNSURE_EXTEND` for how a seed grows into a
 * span.
 */
export const UNSURE_THRESHOLD = 0.7;

/**
 * Confidence threshold below which a word EXTENDS an already-seeded span
 * (docs/implemented-plans/transcript-confidence.md — span rework,
 * boxholder real-world-use feedback 2026-08-15). The actually-wrong word
 * often scores fine because the recognizer's language model repairs it to
 * something plausible, smearing doubt across its neighbors instead — a
 * single-word mark on just the seed missed that repaired word sitting
 * right next to the dip. Three rules turn seeds into spans:
 *  - **Hysteresis (EXTEND)**: a word below `UNSURE_THRESHOLD` seeds a
 *    span; the span then grows outward, both directions, transitively,
 *    across adjacent words below this looser `UNSURE_EXTEND` cusp — a
 *    maximal contiguous run of sub-0.9 words that contains at least one
 *    sub-0.7 seed is wholly included.
 *  - **Bridge**: two spans separated by EXACTLY one word land in one span
 *    — the single-good-word-between-two-dips shape is precisely the
 *    repaired-word case this rework targets. A two-word (or wider) gap
 *    stays two spans.
 *  - **Sentence stop**: a span never crosses sentence-final punctuation
 *    (a word whose text ends in `.`, `?`, or `!`) — extension and
 *    bridging both stop there, even if the confidence numbers alone would
 *    have joined across it.
 * A word with no reported `confidence` is never a seed and never
 * extends/bridges via its OWN low confidence, but a no-confidence word can
 * still be the single bridged-over gap between two real spans (rule 5,
 * same plan section) — it's transparent, not confident, but not a wall
 * either.
 */
export const UNSURE_EXTEND = 0.9;

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

function isSentenceFinal(word: string): boolean {
  // Tolerate closing quotes/brackets after the terminator (`agent."`,
  // `done!)`) — the words stream carries Deepgram's punctuated form, and a
  // span must not cross a sentence end just because a quote trails it.
  return /[!.?]["')\]’”]*$/.test(word.trim());
}

/**
 * Seed → extend → bridge over the WORDS array (no body knowledge at all —
 * see `matchWordsToTokens` for the separate projection onto body tokens).
 * Returns each span as an inclusive `[start, end]` word-index range. See
 * `UNSURE_EXTEND`'s doc comment for the three rules this implements.
 */
function computeWordSpans(words: readonly FinalWord[]): Array<{ start: number; end: number }> {
  const n = words.length;
  const confidence = words.map((w) => (typeof w.confidence === "number" ? w.confidence : null));
  const seed = confidence.map((c) => c !== null && c < UNSURE_THRESHOLD);
  const extendable = confidence.map((c) => c !== null && c < UNSURE_EXTEND);
  const sentenceEnd = words.map((w) => isSentenceFinal(w.word));

  // EXTEND: a maximal contiguous run of extendable words (never crossing a
  // sentence boundary) is wholly marked when it contains at least one seed.
  const marked = Array.from({ length: n }, () => false);
  let i = 0;
  while (i < n) {
    if (!extendable[i]) {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < n && extendable[j + 1] === true && !sentenceEnd[j]) {
      j += 1;
    }
    const runHasSeed = seed.slice(i, j + 1).some(Boolean);
    if (runHasSeed) {
      for (let k = i; k <= j; k += 1) marked[k] = true;
    }
    i = j + 1;
  }

  // BRIDGE: exactly one unmarked word between two marked words joins them,
  // unless a sentence boundary sits on either side of the gap. A single
  // left-to-right pass already resolves chains (each gap is evaluated
  // against its immediate neighbors' CURRENT marks, and extension marks
  // never change after this point), so no fixpoint loop is needed.
  for (let k = 1; k < n - 1; k += 1) {
    if (marked[k]) continue;
    if (marked[k - 1] && marked[k + 1] && !sentenceEnd[k - 1] && !sentenceEnd[k]) {
      marked[k] = true;
    }
  }

  // Group into spans. Two directly-adjacent marked words (no gap — BRIDGE
  // above only fills exactly-one-word gaps, this is the zero-gap case) must
  // still not fuse across a sentence boundary: EXTEND's own run-building
  // never lets an interior word be sentence-final, but two INDEPENDENTLY
  // marked seeds/runs can still land next to each other with a sentence
  // break between them (e.g. "...agent." seeds, "something..." seeds too).
  const spans: Array<{ start: number; end: number }> = [];
  let s = 0;
  while (s < n) {
    if (!marked[s]) {
      s += 1;
      continue;
    }
    let e = s;
    while (e + 1 < n && marked[e + 1] && !sentenceEnd[e]) e += 1;
    spans.push({ start: s, end: e });
    s = e + 1;
  }
  return spans;
}

/**
 * Project one word-span onto body-token index runs, splitting wherever a
 * control-markup tag token (`norm === ""`) sits between two of the span's
 * matched tokens — a span never contains or crosses one. Unmatched *body*
 * tokens in a gap (real text no word in the span matched) don't split a
 * run; unmatched *words* in the span simply contribute no index. A span
 * with no matched words anywhere contributes no runs at all.
 */
function projectSpanToTokenRuns(
  span: { start: number; end: number },
  opts: { matches: readonly (number | null)[]; tokens: readonly BodyToken[] },
): number[][] {
  const { matches, tokens } = opts;
  const indices: number[] = [];
  for (let w = span.start; w <= span.end; w += 1) {
    const m = matches[w];
    if (m !== null && m !== undefined) indices.push(m);
  }
  const first = indices[0];
  if (first === undefined) return [];
  const runs: number[][] = [[first]];
  for (const [k, cur] of indices.entries()) {
    if (k === 0) continue;
    const prev = indices[k - 1];
    if (prev === undefined) continue;
    let hasTagBetween = false;
    for (let t = prev + 1; t < cur; t += 1) {
      if (tokens[t]?.norm === "") { hasTagBetween = true; break; }
    }
    if (hasTagBetween) {
      runs.push([cur]);
    } else {
      runs[runs.length - 1]?.push(cur);
    }
  }
  return runs;
}

/**
 * Wrap low-confidence PHRASE SPANS in `body` with `<unsure>…</unsure>`, in
 * place. `body` is returned byte-identical when `words` is empty or
 * nothing seeded a span — callers can call this unconditionally once
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
  const matches = matchWordsToTokens(tokens, { words: opts.words, spokenStart });
  const wordSpans = computeWordSpans(opts.words);

  const ranges: Array<{ start: number; end: number }> = [];
  for (const span of wordSpans) {
    for (const run of projectSpanToTokenRuns(span, { matches, tokens })) {
      const first = run[0];
      const last = run[run.length - 1];
      if (first === undefined || last === undefined) continue;
      const firstToken = tokens[first];
      const lastToken = tokens[last];
      if (firstToken === undefined || lastToken === undefined) continue;
      ranges.push({ start: firstToken.coreStart, end: lastToken.coreEnd });
    }
  }
  if (ranges.length === 0) {
    return body;
  }

  let result = "";
  let lastEnd = 0;
  for (const range of ranges) {
    result += body.slice(lastEnd, range.start);
    result += `<unsure>${body.slice(range.start, range.end)}</unsure>`;
    lastEnd = range.end;
  }
  result += body.slice(lastEnd);
  return result;
}
