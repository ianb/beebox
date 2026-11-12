// Note names and scales. A sketch names notes ("C4", "F#5", "Bb3") so its
// sounds stay in tune; `scaleNote` maps a step count onto a scale.
import { SketchUsageError } from "../errors.js";

const LETTERS: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const NOTE = /^([A-G])(#|b)?(-?\d)$/;

/** Semitone intervals of each scale from its root. */
export const SCALES = {
  pentatonic: [0, 2, 4, 7, 9],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
} as const;

export type ScaleName = keyof typeof SCALES;

/** The MIDI number of a note name (`"A4"` is 69), or undefined when the name is not a note. */
export function midiOf(name: string): number | undefined {
  const match = NOTE.exec(name);
  if (match === null) return undefined;
  const [, letter = "C", accidental, octave = "4"] = match;
  const shift = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  return (Number(octave) + 1) * 12 + (LETTERS[letter] ?? 0) + shift;
}

/** The frequency of a note name in Hz (A4 = 440). Throws on a name that is not a note. */
export function noteFreq(name: string): number {
  const midi = midiOf(name);
  if (midi === undefined) throw new SketchUsageError({ detail: `${JSON.stringify(name)} is not a note name (use a letter, an optional # or b, and an octave, like "C4" or "F#5")` });
  return 440 * 2 ** ((midi - 69) / 12);
}

function nameOf(midi: number): string {
  return `${SHARP_NAMES[((midi % 12) + 12) % 12] ?? "C"}${Math.floor(midi / 12) - 1}`;
}

/**
 * The note `step` scale steps above `root` (below it when negative). Step 0
 * is the root; with the 5-note pentatonic scale, step 5 is the root an
 * octave up. Pentatonic steps sound well together in any combination.
 */
export function scaleNote(step: number, options?: { root?: string; scale?: ScaleName }): string {
  const root = midiOf(options?.root ?? "C4");
  if (root === undefined) throw new SketchUsageError({ detail: `scaleNote: root ${JSON.stringify(options?.root)} is not a note name` });
  if (!Number.isInteger(step)) throw new SketchUsageError({ detail: `scaleNote: step must be an integer (got ${String(step)})` });
  const scale = options?.scale ?? "pentatonic";
  if (!Object.hasOwn(SCALES, scale)) throw new SketchUsageError({ detail: `scaleNote: scale must be pentatonic, major or minor (got ${JSON.stringify(scale)})` });
  const intervals: readonly number[] = SCALES[scale];
  const octave = Math.floor(step / intervals.length);
  const index = step - octave * intervals.length;
  const midi = root + octave * 12 + (intervals[index] ?? 0);
  if (midi < 12 || midi > 120) {
    throw new SketchUsageError({ detail: `scaleNote: step ${step} from ${options?.root ?? "C4"} leaves C0..C9; keep the step in range (wrap it with %)` });
  }
  return nameOf(midi);
}
