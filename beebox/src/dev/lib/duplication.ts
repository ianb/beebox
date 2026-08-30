/**
 * Duplication detection across named text fragments — a simple, deterministic
 * shingle-overlap experiment for the prompt viewer. Pure functions, no I/O.
 *
 * Method: normalize each fragment to a word list (lowercase, punctuation → space,
 * collapse whitespace), take overlapping 8-word shingles, and for each fragment
 * pair find runs of shingles that are contiguous in BOTH fragments. Each of A's
 * shingles is looked up at its position(s) in B, and a run extends only while
 * consecutive A-positions map to consecutive B-positions (the same diagonal) —
 * so a shared span must be a single contiguous passage in each fragment, not a
 * collection of A-shingles that happen to appear scattered across B. Maximal
 * same-diagonal runs of ≥ 12 words are reported.
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
 * Maximal spans of `aWords` that appear as a single contiguous passage in
 * `bWords`. Each A-shingle is matched against its position(s) in B, and a run
 * extends only while consecutive A-positions map to consecutive B-positions
 * (the same diagonal) — so A-shingles scattered across unrelated parts of B
 * never merge into one long span.
 */
function sharedSpans(aWords: string[], bWords: string[]): Span[] {
  const aShingles = shingles(aWords, SHINGLE_SIZE);
  const bShingles = shingles(bWords, SHINGLE_SIZE);

  // Each distinct B-shingle → the positions where it occurs in B.
  const bPositions = new Map<string, number[]>();
  for (const [j, sh] of bShingles.entries()) {
    const list = bPositions.get(sh);
    if (list) list.push(j);
    else bPositions.set(sh, [j]);
  }

  const matches = (i: number, j: number): boolean =>
    i >= 0 && i < aShingles.length && j >= 0 && j < bShingles.length &&
    (aShingles[i] ?? "") === (bShingles[j] ?? "");

  const spans: Span[] = [];
  const seen = new Set<string>();
  for (const [i, aSh] of aShingles.entries()) {
    for (const j of bPositions.get(aSh) ?? []) {
      // Only start a run at a diagonal's head (its predecessor doesn't match),
      // so each maximal run is emitted once from its first shingle.
      if (matches(i - 1, j - 1)) continue;
      let len = 1;
      while (matches(i + len, j + len)) len++;
      // A run of `len` shingles from A-position i covers words [i, i+len-1+SHINGLE_SIZE).
      const span = { start: i, end: i + len - 1 + SHINGLE_SIZE };
      const key = `${String(span.start)}:${String(span.end)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      spans.push(span);
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
