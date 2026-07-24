// Locating a nugget span in its source document — the honesty boundary of the
// story-extraction pipeline. Exact verbatim match is the strong guarantee; a
// whitespace-tolerant fallback recovers spans whose only defect is whitespace
// (extraction agents routinely drop the leading indentation on wrapped list-
// continuation lines) WITHOUT weakening fabrication detection: a span whose
// words are genuinely absent from the source still fails.

export type SpanCheck = "ok" | "ambiguous";

export interface SpanLocation {
  kind: SpanCheck | "missing";
  /** The canonical span to store — the exact source substring, never the agent's copy. */
  span: string;
  /** True when whitespace-tolerant recovery was needed (the agent's copy was off). */
  recovered: boolean;
}

/** Count VERBATIM occurrences of needle in haystack (overlaps counted). */
export function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) break;
    count++;
    pos = idx + 1;
  }
  return count;
}

// Collapse every run of whitespace to a single space, returning the normalized
// string plus a map from each normalized-char index back to its source index
// (a collapsed run maps to the run's first char).
function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i] ?? "")) {
      const runStart = i;
      while (i < s.length && /\s/.test(s[i] ?? "")) i++;
      norm += " ";
      map.push(runStart);
    } else {
      norm += s[i] ?? "";
      map.push(i);
      i++;
    }
  }
  return { norm, map };
}

// Locate a nugget span in its source. Exact verbatim match is the fast path. On
// zero exact matches, fall back to whitespace-tolerant matching: normalize
// whitespace in both, and if the span's words appear in the source EXACTLY ONCE
// in order, store the real source substring (so stored text is always verbatim
// and the agent's whitespace error is corrected rather than lost). Words
// genuinely absent → "missing" (fabrication still caught); >1 match → "ambiguous".
export function locateSpan(docText: string, span: string): SpanLocation {
  const exact = countOccurrences(docText, span);
  if (exact === 1) return { kind: "ok", span, recovered: false };
  if (exact > 1) return { kind: "ambiguous", span, recovered: false };

  const needle = span.replace(/\s+/g, " ").trim();
  if (!needle) return { kind: "missing", span, recovered: false };
  const { norm, map } = normalizeWithMap(docText);
  const occ = countOccurrences(norm, needle);
  if (occ === 0) return { kind: "missing", span, recovered: false };
  if (occ > 1) return { kind: "ambiguous", span, recovered: true };
  const nStart = norm.indexOf(needle);
  const srcStart = map[nStart] ?? 0;
  const srcEnd = (map[nStart + needle.length - 1] ?? srcStart) + 1;
  return { kind: "ok", span: docText.slice(srcStart, srcEnd), recovered: true };
}
