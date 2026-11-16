// The faint-mark warning (dev-loop row 42), the Canvas2D painter's rule, kept:
// a brushed mark whose strongest pixel lands under 8% opacity, after its
// brush, paint, paper grain and the groups around it, cannot be seen, and an
// agent would otherwise spend a render cycle finding that out. The renderer
// measures each mark (gpu/peaks.ts); this decides which to warn about: each
// sketch line once per run, at most 8, then one line saying the rest are
// suppressed. `gesture({ faint: true })` marks are never measured.

/** A mark whose strongest pixel is under this opacity counts as too faint to see. */
export const FAINT = 0.08;
export const MAX_FAINT_WARNINGS = 8;

/** One measured mark: its call, its strength, and the sketch line that drew it. */
export interface MeasuredMark {
  readonly call: string;
  readonly alpha: number;
  readonly line: string | undefined;
}

/** What a run has warned about so far. */
export interface FaintState {
  readonly lines: Set<string>;
  count: number;
}

export const faintState = (): FaintState => ({ lines: new Set(), count: 0 });

/** The warnings for one rendered frame's marks, given what the run warned about before (`state`, updated). */
export function faintWarnings(marks: readonly MeasuredMark[], state: FaintState): string[] {
  const out: string[] = [];
  for (const m of marks) {
    if (m.alpha >= FAINT || state.count > MAX_FAINT_WARNINGS) continue;
    const key = m.line ?? "";
    if (state.lines.has(key)) continue;
    state.lines.add(key);
    state.count++;
    if (state.count > MAX_FAINT_WARNINGS) {
      out.push("faint marks: more marks are too faint to see; further warnings suppressed");
      continue;
    }
    out.push(`faint mark (${m.call}): it reaches only ${Math.round(m.alpha * 100)}% opacity and will barely show (gesture({ faint: true }) marks it as intended)${m.line === undefined ? "" : ` (at ${m.line})`}`);
  }
  return out;
}
