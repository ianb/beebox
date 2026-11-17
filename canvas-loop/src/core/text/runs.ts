// Text runs: one line of text in pieces, each a subscript, a superscript or
// another style, measured and drawn as one text with one box and one baseline.
// The sizes and shifts follow the usual look of HTML `<sub>` and `<sup>`.
import { SketchUsageError } from "../errors.js";
import type { TextOptions, TextRun, TextStyle } from "../paint.js";

/** A sub or sup run's size, as a multiple of the call's size. */
const SMALL = 0.7;
/** How far a sub run's baseline moves down, and a sup run's up, as multiples of the call's size. */
const SUB_DOWN = 0.22;
const SUP_UP = 0.38;
const KEYS = ["text", "sub", "sup", "style"];

/** One run as the measurer reads it: its size and baseline move as multiples of the call's size. */
export interface RunSpec {
  readonly text: string;
  readonly scale: number;
  readonly shift: number;
  readonly style: TextStyle | undefined;
}

/** The runs with their sizes and moves; a string run is the call's own text. */
export function runSpecs(runs: readonly TextRun[]): RunSpec[] {
  return runs.map((r) => {
    if (typeof r === "string") return { text: r, scale: 1, shift: 0, style: undefined };
    const small = r.sub === true || r.sup === true;
    return { text: r.text, scale: small ? SMALL : 1, shift: r.sub === true ? SUB_DOWN : r.sup === true ? -SUP_UP : 0, style: r.style };
  });
}

/** The text a list of runs writes, joined. */
export const runsText = (content: string | readonly TextRun[]): string => (typeof content === "string" ? content : runSpecs(content).map((r) => r.text).join(""));

function checkRun(run: unknown, call: string): void {
  if (typeof run === "string") {
    if (run.includes("\n")) throw new SketchUsageError({ detail: `${call}: runs are one line; a run holds "\\n", so draw each line with its own v.text` });
    return;
  }
  if (typeof run !== "object" || run === null) throw new SketchUsageError({ detail: `${call}: a run is a string or { text, sub?, sup?, style? } (got ${typeof run})` });
  for (const key of Object.keys(run)) {
    if (KEYS.includes(key)) continue;
    const why = key === "fill" ? "; a text has one paint, so draw a run in another color as its own v.text" : "";
    throw new SketchUsageError({ detail: `${call}: unknown run key "${key}" (${KEYS.join(", ")})${why}` });
  }
  const text: unknown = Reflect.get(run, "text");
  if (typeof text !== "string") throw new SketchUsageError({ detail: `${call}: a run's text must be a string (got ${typeof text})` });
  checkRun(text, call);
  if (Reflect.get(run, "sub") === true && Reflect.get(run, "sup") === true) throw new SketchUsageError({ detail: `${call}: a run is sub or sup, not both (${JSON.stringify(text)})` });
}

/** Throw at `call` for runs a text cannot draw: more than one line, `wrap: true`, an unknown key, or both `sub` and `sup`. */
export function checkContent(content: string | readonly TextRun[], at: { call: string; options: TextOptions | undefined }): void {
  if (typeof content === "string") return;
  if (!Array.isArray(content)) throw new SketchUsageError({ detail: `${at.call}: text is a string or a list of runs (got ${typeof content})` });
  if (at.options?.wrap === true) throw new SketchUsageError({ detail: `${at.call}: runs are one line and do not wrap; leave wrap out (a w box aligns the line)` });
  for (const run of content) checkRun(run, at.call);
}
