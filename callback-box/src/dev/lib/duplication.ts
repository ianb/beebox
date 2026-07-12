/**
 * Duplication detection across named text fragments — a simple, deterministic
 * shingle-overlap experiment for the prompt viewer. Pure functions, no I/O.
 *
 * Method: normalize each fragment to a word list (lowercase, punctuation → space,
 * collapse whitespace), take overlapping 8-word shingles, and for each fragment
 * pair find runs of consecutive shingles that also occur in the other fragment.
 * Consecutive shingles overlap by 7 words, so a run of matching shingle
 * positions collapses into one maximal shared span automatically. Spans of ≥ 12
 * words are reported.
 *
 * Reported span text is the NORMALIZED span (the lowercased, punctuation-stripped
 * words) taken from fragment `a` — chosen over reconstructing the original
 * casing/punctuation because it is simpler and fully deterministic. It is still
 * a faithful, human-legible rendering of the shared content.
 */

const SHINGLE_SIZE = 8;
const MIN_SPAN_WORDS = 12;

export interface Fragment {
  name: string;
  text: string;
}

export interface DuplicationFinding {
  /** Name of the first fragment in the pair. */
  a: string;
  /** Name of the second fragment in the pair. */
  b: string;
  /** Length of the shared span, in words. */
  words: number;
  /** The shared span text (normalized), taken from fragment `a`. */
  text: string;
}

/**
 * Estimate a token count from raw text as `round(length / 3.7)`. This is a
 * deterministic ESTIMATE (a rough chars-per-token heuristic), not a real
 * tokenizer — good enough for relative size comparisons, never billing.
 */
export function estimateTokens(text: string): number {
  return Math.round(text.length / 3.7);
}

/** Normalize text to a list of words: lowercase, punctuation → space, collapse. */
function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Overlapping shingles of `size` consecutive words, joined by single spaces. */
function shingles(words: string[], size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + size <= words.length; i++) {
    out.push(words.slice(i, i + size).join(" "));
  }
  return out;
}

interface Span {
  /** Inclusive start word index. */
  start: number;
  /** Exclusive end word index. */
  end: number;
}

/**
 * Maximal spans of `aWords` where each covering 8-word shingle also appears in
 * `bWords`. Consecutive matching shingle positions merge into one span.
 */
function sharedSpans(aWords: string[], bWords: string[]): Span[] {
  const bShingles = new Set(shingles(bWords, SHINGLE_SIZE));
  const aShingles = shingles(aWords, SHINGLE_SIZE);
  const spans: Span[] = [];
  let runStart = -1;
  for (let i = 0; i <= aShingles.length; i++) {
    const matched = i < aShingles.length && bShingles.has(aShingles[i] ?? "");
    if (matched) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      // Last matching shingle was at i-1, covering words up to (i-1)+SHINGLE_SIZE.
      spans.push({ start: runStart, end: i - 1 + SHINGLE_SIZE });
      runStart = -1;
    }
  }
  return spans;
}

/** Collapse fragments with byte-identical text, keeping the first name seen. */
function dedupeByText(fragments: Fragment[]): Fragment[] {
  const byText = new Map<string, Fragment>();
  for (const fragment of fragments) {
    if (!byText.has(fragment.text)) byText.set(fragment.text, fragment);
  }
  return [...byText.values()];
}

/**
 * Find shared spans (≥ 12 words) across every pair of named fragments. Fragments
 * with identical text are collapsed first (so the same content appearing in two
 * places never self-matches). Findings are sorted by word count descending.
 */
export function findDuplication(fragments: Fragment[]): DuplicationFinding[] {
  const unique = dedupeByText(fragments);
  const normalized = unique.map((fragment) => ({
    name: fragment.name,
    words: normalizeWords(fragment.text),
  }));

  const findings: DuplicationFinding[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const a = normalized[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < normalized.length; j++) {
      const b = normalized[j];
      if (b === undefined) continue;
      for (const span of sharedSpans(a.words, b.words)) {
        const words = span.end - span.start;
        if (words < MIN_SPAN_WORDS) continue;
        findings.push({
          a: a.name,
          b: b.name,
          words,
          text: a.words.slice(span.start, span.end).join(" "),
        });
      }
    }
  }

  findings.sort(
    (x, y) => y.words - x.words || x.a.localeCompare(y.a) || x.b.localeCompare(y.b),
  );
  return findings;
}
