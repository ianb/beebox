// Sounds as data. A sketch's `sound(model, p)` returns the voices that exist;
// each voice is one sound with a fixed start frame. The same id is the same
// sound for the whole run, so the audio up to any frame depends only on the
// voices declared up to that frame.
import { SketchUsageError } from "../errors.js";
import { INSTRUMENTS } from "./instruments.js";
import type { Instrument } from "./instruments.js";
import { SAMPLE_NAMES, isSampleName } from "./library/catalog.js";
import type { SampleName } from "./library/catalog.js";
import { midiOf } from "./notes.js";

interface VoiceBase {
  /** Names the sound. Return the same id while the sound exists; a new id is a new sound. */
  readonly id: string;
  /** The frame the sound starts on (60 frames a second by default). */
  readonly at: number;
  /** Loudness, 0..1 (default 0.5). */
  readonly gain?: number;
}

/** A plucked string (Karplus–Strong). */
export interface PluckVoice extends VoiceBase {
  readonly kind: "pluck";
  /** Pitch in Hz. */
  readonly freq: number;
  /** Seconds until it has died away (default 2). */
  readonly decay?: number;
  /** 0 dull .. 1 bright (default 0.5). */
  readonly brightness?: number;
}

/** A steady tone with a short fade in and out. */
export interface ToneVoice extends VoiceBase {
  readonly kind: "tone";
  readonly freq: number;
  /** Seconds. */
  readonly duration: number;
  readonly wave?: "sine" | "triangle" | "square";
}

/** A burst of noise that fades over `duration` (a click, a tap, a swish). */
export interface NoiseVoice extends VoiceBase {
  readonly kind: "noise";
  readonly duration: number;
}

/** One note on a synthesized instrument (see `INSTRUMENTS`). */
export interface NoteVoice extends VoiceBase {
  readonly kind: "note";
  readonly instrument: Instrument;
  /** A note name: a letter, an optional # or b, and an octave ("C4", "F#5", "Bb3"). */
  readonly note: string;
  /** Seconds. A struck instrument rings this long at most; the pad holds this long, then fades. */
  readonly duration?: number;
}

/** A recorded sound from the sample library, by name (see `SAMPLES`). */
export interface SampleVoice extends VoiceBase {
  readonly kind: "sample";
  readonly name: SampleName;
  /** Which take of the sound (default 0; wraps around the takes there are). Vary it for repeated sounds. */
  readonly variant?: number;
  /** Playback speed, 0.5..2 (default 1). Faster is higher and shorter. */
  readonly rate?: number;
}

export type Voice = PluckVoice | ToneVoice | NoiseVoice | NoteVoice | SampleVoice;

const WAVES: ReadonlySet<string> = new Set(["sine", "triangle", "square"]);

/** Longest sound a voice can make, in seconds. */
export const MAX_SECONDS = 10;

const KEYS: Record<Voice["kind"], ReadonlySet<string>> = {
  pluck: new Set(["id", "at", "gain", "kind", "freq", "decay", "brightness"]),
  tone: new Set(["id", "at", "gain", "kind", "freq", "duration", "wave"]),
  noise: new Set(["id", "at", "gain", "kind", "duration"]),
  note: new Set(["id", "at", "gain", "kind", "instrument", "note", "duration"]),
  sample: new Set(["id", "at", "gain", "kind", "name", "variant", "rate"]),
};

const INSTRUMENT_SET: ReadonlySet<string> = new Set(INSTRUMENTS);

function check(ok: boolean, problem: { where: string; detail: string }): void {
  if (!ok)
    throw new SketchUsageError({
      detail: `sound: ${problem.where} ${problem.detail}`,
    });
}

function inRange(
  value: number | undefined,
  range: { min: number; max: number; exclusiveMin?: boolean; required?: boolean },
): boolean {
  if (value === undefined) return range.required !== true;
  if (!Number.isFinite(value) || value > range.max) return false;
  return range.exclusiveMin === true ? value > range.min : value >= range.min;
}

function assertNote(voice: NoteVoice, where: string): void {
  check(INSTRUMENT_SET.has(voice.instrument), {
    where,
    detail: `"instrument" must be one of ${INSTRUMENTS.join(", ")} (got ${JSON.stringify(voice.instrument)})`,
  });
  const midi = typeof voice.note === "string" ? midiOf(voice.note) : undefined;
  check(midi !== undefined && midi >= 12 && midi <= 120, {
    where,
    detail: `"note" must be a note name from C0 to C9, like "C4", "F#5" or "Bb3" (got ${JSON.stringify(voice.note)})`,
  });
  check(inRange(voice.duration, { min: 0, max: MAX_SECONDS, exclusiveMin: true }), {
    where,
    detail: `"duration" must be over 0 and at most ${MAX_SECONDS} seconds`,
  });
}

function assertSample(voice: SampleVoice, where: string): void {
  check(typeof voice.name === "string" && isSampleName(voice.name), {
    where,
    detail: `"name" must be a library sound (got ${JSON.stringify(voice.name)}); the sounds are: ${SAMPLE_NAMES.join(", ")}`,
  });
  check(voice.variant === undefined || (Number.isInteger(voice.variant) && voice.variant >= 0), {
    where,
    detail: `"variant" must be an integer ≥ 0 (got ${String(voice.variant)})`,
  });
  check(inRange(voice.rate, { min: 0.5, max: 2 }), {
    where,
    detail: `"rate" must be 0.5..2 (got ${String(voice.rate)})`,
  });
}

/** Check one voice; errors name the voice and the key. */
export function assertVoice(voice: Voice): void {
  const id =
    typeof voice.id === "string" && voice.id !== "" ? voice.id : undefined;
  check(id !== undefined, {
    where: "voice",
    detail: `needs an "id" string (got ${JSON.stringify(voice.id)})`,
  });
  const where = `voice "${String(id)}"`;
  check(Object.hasOwn(KEYS, voice.kind), {
    where,
    detail: `has unknown kind ${JSON.stringify(voice.kind)} (${Object.keys(KEYS).join(", ")})`,
  });
  for (const key of Object.keys(voice))
    check(KEYS[voice.kind].has(key), {
      where,
      detail: `has unknown key "${key}" for a ${voice.kind}`,
    });
  check(Number.isInteger(voice.at) && voice.at >= 0, {
    where,
    detail: `"at" must be a frame number ≥ 0 (got ${String(voice.at)})`,
  });
  check(inRange(voice.gain, { min: 0, max: 1 }), {
    where,
    detail: `"gain" must be 0..1 (got ${String(voice.gain)})`,
  });
  if (voice.kind === "note") {
    assertNote(voice, where);
    return;
  }
  if (voice.kind === "sample") {
    assertSample(voice, where);
    return;
  }
  if (voice.kind === "noise") {
    check(
      inRange(voice.duration, {
        min: 0,
        max: MAX_SECONDS,
        exclusiveMin: true,
        required: true,
      }),
      {
        where,
        detail: `"duration" must be over 0 and at most ${MAX_SECONDS} seconds`,
      },
    );
    return;
  }
  check(inRange(voice.freq, { min: 20, max: 20_000, required: true }), {
    where,
    detail: `"freq" must be 20..20000 Hz (got ${String(voice.freq)})`,
  });
  if (voice.kind === "tone") {
    check(voice.wave === undefined || WAVES.has(voice.wave), {
      where,
      detail: `"wave" must be sine, triangle or square (got ${JSON.stringify(voice.wave)})`,
    });
    check(
      inRange(voice.duration, {
        min: 0,
        max: MAX_SECONDS,
        exclusiveMin: true,
        required: true,
      }),
      {
        where,
        detail: `"duration" must be over 0 and at most ${MAX_SECONDS} seconds`,
      },
    );
    return;
  }
  check(
    inRange(voice.decay, { min: 0, max: MAX_SECONDS, exclusiveMin: true }),
    {
      where,
      detail: `"decay" must be over 0 and at most ${MAX_SECONDS} seconds`,
    },
  );
  check(inRange(voice.brightness, { min: 0, max: 1 }), {
    where,
    detail: '"brightness" must be 0..1',
  });
}

/** What a transcript line says about a voice after its kind and id: its pitch, instrument or sample. */
export function voiceDetail(voice: Voice): string {
  switch (voice.kind) {
    case "noise":
      return "";
    case "note":
      return ` ${voice.instrument} ${voice.note}`;
    case "sample":
      return ` ${voice.name}${voice.variant === undefined ? "" : ` #${voice.variant}`}`;
    case "pluck":
    case "tone":
      return ` ${voice.freq} Hz`;
  }
}

/** Most new voices one frame may declare. */
export const MAX_NEW_PER_FRAME = 32;

/**
 * The run's voices by id. A voice is one occurrence: re-declaring an id with
 * the same data is harmless, with different data is an error, and a new
 * voice may not start before the frame that declares it.
 */
export class Score {
  #voices = new Map<string, { voice: Voice; key: string }>();

  /** Add the voices `sound` returned after frame `frame`'s tick. Returns the newly seen ones. */
  add(voices: readonly Voice[], frame: number): Voice[] {
    const added: Voice[] = [];
    for (const voice of voices) {
      assertVoice(voice);
      const key = JSON.stringify(voice, Object.keys(voice).toSorted());
      const seen = this.#voices.get(voice.id);
      if (seen !== undefined) {
        if (seen.key !== key) {
          throw new SketchUsageError({
            detail: `sound: voice "${voice.id}" changed after it was first declared; a voice is one sound, so give a new sound a new id`,
          });
        }
        continue;
      }
      if (voice.at < frame) {
        throw new SketchUsageError({
          detail: `sound: voice "${voice.id}" starts at frame ${voice.at}, before frame ${frame} where it was first declared`,
        });
      }
      this.#voices.set(voice.id, { voice: { ...voice }, key });
      added.push(voice);
    }
    if (added.length > MAX_NEW_PER_FRAME) {
      throw new SketchUsageError({
        detail: `sound: ${added.length} new voices on frame ${frame} (at most ${MAX_NEW_PER_FRAME})`,
      });
    }
    return added;
  }

  /** Every voice seen, in first-seen order. */
  voices(): Voice[] {
    return [...this.#voices.values()].map((entry) => entry.voice);
  }

  clear(): void {
    this.#voices.clear();
  }
}
