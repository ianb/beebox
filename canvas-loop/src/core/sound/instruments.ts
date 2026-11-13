// Synthesized instruments for `note` voices. Each is a pure function of
// frequency, length and sample rate, so a note renders the same samples in
// every runtime. Struck instruments (marimba, bell, kalimba) are sums of
// decaying sine partials (modal synthesis); the electric piano is two-operator
// FM; the pad is three detuned, softened saw-like tones.

/** Instrument names a `note` voice accepts. */
export const INSTRUMENTS = ["marimba", "bell", "kalimba", "epiano", "pad"] as const;

export type Instrument = (typeof INSTRUMENTS)[number];

/** Seconds a note lasts when the voice gives no `duration`. */
export const DEFAULT_SECONDS: Readonly<Record<Instrument, number>> = {
  marimba: 1.2,
  bell: 3,
  kalimba: 1.5,
  epiano: 1.5,
  pad: 1.5,
};

/** What every instrument renders from. */
interface Shape {
  freq: number;
  seconds: number;
  sampleRate: number;
}

interface Partial {
  /** Frequency as a multiple of the note's. */
  ratio: number;
  amp: number;
  /** Seconds to fall to 1/e. */
  tau: number;
}

const ATTACK = 0.003;
const TAIL = 0.02;

/** A short fade in, and a fade out over the last `TAIL` seconds, so a cut note does not click. */
function edges(at: number, span: { length: number; sampleRate: number }): number {
  const { length, sampleRate } = span;
  const fadeIn = Math.max(1, ATTACK * sampleRate);
  const fadeOut = Math.max(1, TAIL * sampleRate);
  return Math.min(1, at / fadeIn, (length - at) / fadeOut);
}

function modal(partials: readonly Partial[], args: Shape): Float32Array<ArrayBuffer> {
  const { freq, seconds, sampleRate } = args;
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  const nyquist = sampleRate / 2;
  for (const partial of partials) {
    const f = freq * partial.ratio;
    if (f >= nyquist * 0.9) continue;
    const step = (2 * Math.PI * f) / sampleRate;
    const fall = 1 / (partial.tau * sampleRate);
    for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) + partial.amp * Math.exp(-fall * i) * Math.sin(step * i);
  }
  return out;
}

/** Higher notes ring shorter, as on a real bar or tine. */
function pitchScale(freq: number): number {
  return (440 / freq) ** 0.35;
}

function marimba(shape: Shape): Float32Array<ArrayBuffer> {
  const k = pitchScale(shape.freq);
  return modal(
    [
      { ratio: 1, amp: 1, tau: 0.42 * k },
      { ratio: 3.93, amp: 0.3, tau: 0.09 * k },
      { ratio: 9.2, amp: 0.12, tau: 0.03 * k },
    ],
    shape,
  );
}

function bell(shape: Shape): Float32Array<ArrayBuffer> {
  const k = pitchScale(shape.freq);
  // Church-bell partials: hum, prime, minor third, fifth, nominal, and upper partials.
  return modal(
    [
      { ratio: 0.5, amp: 0.35, tau: 1.6 * k },
      { ratio: 1, amp: 1, tau: 1.1 * k },
      { ratio: 1.19, amp: 0.45, tau: 0.8 * k },
      { ratio: 1.5, amp: 0.25, tau: 0.6 * k },
      { ratio: 2, amp: 0.5, tau: 0.5 * k },
      { ratio: 2.74, amp: 0.2, tau: 0.3 * k },
      { ratio: 4.07, amp: 0.12, tau: 0.18 * k },
    ],
    shape,
  );
}

function kalimba(shape: Shape): Float32Array<ArrayBuffer> {
  const k = pitchScale(shape.freq);
  return modal(
    [
      { ratio: 1, amp: 1, tau: 0.55 * k },
      { ratio: 2, amp: 0.08, tau: 0.2 * k },
      { ratio: 5.9, amp: 0.22, tau: 0.04 * k },
      { ratio: 15.3, amp: 0.06, tau: 0.012 * k },
    ],
    shape,
  );
}

function epiano(shape: Shape): Float32Array<ArrayBuffer> {
  const { freq, seconds, sampleRate } = shape;
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  const k = pitchScale(freq);
  const ampFall = 1 / (0.9 * k * sampleRate);
  const indexFall = 1 / (0.25 * sampleRate);
  const tineFall = 1 / (0.05 * sampleRate);
  const w = (2 * Math.PI * freq) / sampleRate;
  // The tine's sidebands reach about 20× the note; above Nyquist they would fold back as noise.
  const tineLevel = freq * 20 < sampleRate / 2 ? 0.18 : 0;
  for (let i = 0; i < out.length; i += 1) {
    // The modulator at the same frequency gives the warm body; its index falls
    // quickly, so the attack is bright and the tail mellow. A faint high
    // modulator adds the tine's bark at the start.
    const index = 0.4 + 1.8 * Math.exp(-indexFall * i);
    const body = Math.sin(w * i + index * Math.sin(w * i));
    const tine = tineLevel * Math.exp(-tineFall * i) * Math.sin(w * 7 * i + 1.5 * Math.sin(w * 14 * i));
    out[i] = Math.exp(-ampFall * i) * (body + tine);
  }
  return out;
}

const DETUNE = [0.996, 1, 1.004] as const;
const PAD_ATTACK = 0.25;
const PAD_RELEASE = 0.4;
/** No pad harmonic above this, in Hz. */
const PAD_CEILING = 5000;
/** Harmonics above about this frequency fade, in Hz. */
const PAD_SOFTEN = 1200;

function pad(shape: Shape): Float32Array<ArrayBuffer> {
  const { freq, seconds, sampleRate } = shape;
  // `seconds` is the held time; the release follows it.
  const total = seconds + PAD_RELEASE;
  const out = new Float32Array(Math.ceil(total * sampleRate));
  // Saw-like harmonics (1/n), rolled off above `ceiling`, summed directly so
  // nothing aliases: a soft, warm tone.
  const ceiling = Math.min(PAD_CEILING, sampleRate * 0.4);
  for (const [n, detune] of DETUNE.entries()) {
    const f = freq * detune;
    // The fundamental always sounds (below Nyquist), even above the soft ceiling.
    for (let harmonic = 1; harmonic === 1 ? f < sampleRate * 0.45 : harmonic * f < ceiling; harmonic += 1) {
      const amp = 1 / harmonic / (1 + ((harmonic * f) / PAD_SOFTEN) ** 2);
      const step = (2 * Math.PI * harmonic * f) / sampleRate;
      const phase = (n * harmonic * 2 * Math.PI) / 3;
      for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) + amp * Math.sin(step * i + phase);
    }
  }
  for (let i = 0; i < out.length; i += 1) {
    const t = i / sampleRate;
    const swell = Math.min(1, t / PAD_ATTACK);
    const release = t <= seconds ? 1 : Math.max(0, 1 - (t - seconds) / PAD_RELEASE);
    out[i] = (out[i] ?? 0) * swell * release;
  }
  return out;
}

const RENDER: Readonly<Record<Instrument, (shape: Shape) => Float32Array<ArrayBuffer>>> = {
  marimba,
  bell,
  kalimba,
  epiano,
  pad,
};

/**
 * One note's samples, scaled so its loudest sample is `gain`. Struck
 * instruments ring for `seconds` (cut with a short fade); the pad holds for
 * `seconds`, then releases.
 */
export function renderNote(
  instrument: Instrument,
  note: { freq: number; seconds: number; gain: number; sampleRate: number },
): Float32Array<ArrayBuffer> {
  const out = RENDER[instrument](note);
  let peak = 0;
  for (let i = 0; i < out.length; i += 1) {
    out[i] = (out[i] ?? 0) * edges(i, { length: out.length, sampleRate: note.sampleRate });
    peak = Math.max(peak, Math.abs(out[i] ?? 0));
  }
  const scale = peak > 0 ? note.gain / peak : 0;
  for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) * scale;
  return out;
}
