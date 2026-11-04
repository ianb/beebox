/** Word error rate and per-utterance live latency from a run's event log. */
export function norm(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
}

export function wer(refText: string, hypText: string): { wer: number; refWords: number; hypWords: number; sub: number; del: number; ins: number } {
  const r = norm(refText);
  const h = norm(hypText);
  // Levenshtein with backtrace counts.
  const m = r.length, n = h.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1));
  }
  let i = m, j = n, sub = 0, del = 0, ins = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i]![j] === d[i - 1]![j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1)) { if (r[i - 1] !== h[j - 1]) sub++; i--; j--; }
    else if (i > 0 && d[i]![j] === d[i - 1]![j]! + 1) { del++; i--; }
    else { ins++; j--; }
  }
  return { wer: m ? (sub + del + ins) / m : 0, refWords: m, hypWords: n, sub, del, ins };
}

export interface Ev { t: number; type: string; text?: string }

/**
 * Live latency: for each utterance, when its last word first showed, and when
 * a final result next arrived, relative to the end of that utterance's audio.
 * Negative is normal: utterance audio ends with trailing silence.
 */
export function liveLatency(events: Ev[], refs: string[], boundsSec: number[]): { lastWordP50: number; lastWordP90: number; finalP50: number; finalP90: number; n: number } {
  const shown = events.filter((e) => e.type === "interim" || e.type === "final");
  const lastWord: number[] = [];
  const final: number[] = [];
  refs.forEach((ref, k) => {
    const end = boundsSec[k]! * 1000;
    const last = norm(ref).at(-1);
    const near = shown.filter((e) => e.t >= end - 1500 && e.t <= end + 6000);
    const hit = near.find((e) => norm(e.text ?? "").at(-1) === last);
    if (hit) lastWord.push(hit.t - end);
    const fin = near.find((e) => e.type === "final" && e.t >= end - 500);
    if (fin) final.push(fin.t - end);
  });
  const at = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.floor(q * (a.length - 1))] ?? NaN;
  return { lastWordP50: at(lastWord, 0.5), lastWordP90: at(lastWord, 0.9), finalP50: at(final, 0.5), finalP90: at(final, 0.9), n: lastWord.length };
}
