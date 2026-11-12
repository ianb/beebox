// Sounds as data. A sketch's `sound(model, p)` returns the voices that exist;
// each voice is one sound with a fixed start frame. The same id is the same
// sound for the whole run, so the audio up to any frame depends only on the
// voices declared up to that frame.
import { SketchUsageError } from "../errors.js";

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

export type Voice = PluckVoice | ToneVoice | NoiseVoice;

/** Longest sound a voice can make, in seconds. */
export const MAX_SECONDS = 10;

const KEYS: Record<Voice["kind"], ReadonlySet<string>> = {
  pluck: new Set(["id", "at", "gain", "kind", "freq", "decay", "brightness"]),
  tone: new Set(["id", "at", "gain", "kind", "freq", "duration", "wave"]),
  noise: new Set(["id", "at", "gain", "kind", "duration"]),
};

function check(ok: boolean, problem: { where: string; detail: string }): void {
  if (!ok)
    throw new SketchUsageError({
      detail: `sound: ${problem.where} ${problem.detail}`,
    });
}

function inRange(
  value: number | undefined,
  range: { min: number; max: number; exclusiveMin?: boolean },
): boolean {
  if (value === undefined) return true;
  if (!Number.isFinite(value) || value > range.max) return false;
  return range.exclusiveMin === true ? value > range.min : value >= range.min;
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
    detail: `has unknown kind ${JSON.stringify(voice.kind)} (pluck, tone, noise)`,
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
  if (voice.kind === "noise") {
    check(
      inRange(voice.duration, { min: 0, max: MAX_SECONDS, exclusiveMin: true }),
      {
        where,
        detail: `"duration" must be over 0 and at most ${MAX_SECONDS} seconds`,
      },
    );
    return;
  }
  check(inRange(voice.freq, { min: 20, max: 20_000 }), {
    where,
    detail: `"freq" must be 20..20000 Hz (got ${String(voice.freq)})`,
  });
  if (voice.kind === "tone") {
    check(
      inRange(voice.duration, { min: 0, max: MAX_SECONDS, exclusiveMin: true }),
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
