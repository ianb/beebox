// Plays a figure's voices. Each voice is rendered by the same synth the
// headless WAV uses, so a voice sounds the same in both. A voice starts when
// the runtime reaches its frame; nothing is scheduled ahead, so pause and
// catch-up cannot drift. Browsers allow audio only after a user gesture:
// `enable()` runs on the first pointer or key press, before that input is
// dispatched, so its own sound plays. Voices before it are skipped.
//
// The sample library (about 700 KB) loads in its own chunk when the player is
// made, so figures without sound never fetch it. A sample voice due before it
// arrives waits up to LATE_MS, then is dropped with a log line.
import type { SampleLibrary } from "../../core/sound/library/samples.js";
import { SAMPLE_RATE, renderVoice } from "../../core/sound/synth.js";
import type { Voice } from "../../core/sound/voice.js";

/** How late a sample voice may start while the library loads. */
const LATE_MS = 250;

export class SoundPlayer {
  #context: AudioContext | undefined;
  #playing = new Set<AudioBufferSourceNode>();
  #skipped = false;
  #log: (message: string) => void;
  #library: SampleLibrary | "loading" | "failed" = "loading";
  #waiting: { voice: Voice; due: number }[] = [];
  #deadline: ReturnType<typeof setTimeout> | undefined;
  #closed = false;

  constructor(log: (message: string) => void) {
    this.#log = log;
    import("../../core/sound/library/bundled.generated.js").then(
      (module) => {
        if (this.#closed) return;
        this.#library = module.bundledLibrary();
        this.#flushWaiting();
      },
      (error: unknown) => {
        if (this.#closed) return;
        this.#library = "failed";
        this.#dropWaiting();
        this.#log(`canvas-loop: the sample library did not load, so sample sounds are silent (${String(error)})`);
      },
    );
  }

  #flushWaiting(): void {
    clearTimeout(this.#deadline);
    this.#deadline = undefined;
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const { voice, due } of waiting) {
      if (performance.now() - due > LATE_MS) {
        this.#log(`canvas-loop: sample "${voice.id}" dropped: the sample library was still loading when it was due`);
        continue;
      }
      try {
        this.play(voice);
      } catch (error) {
        this.#log(`canvas-loop: sample "${voice.id}" did not play (${String(error)})`);
      }
    }
  }

  /** Drop every waiting voice that is past its deadline (all of them, once the load has failed). */
  #dropWaiting(): void {
    clearTimeout(this.#deadline);
    this.#deadline = undefined;
    const now = performance.now();
    const keep = this.#library === "loading" ? this.#waiting.filter(({ due }) => now - due <= LATE_MS) : [];
    for (const { voice } of this.#waiting.filter((entry) => !keep.includes(entry))) {
      this.#log(`canvas-loop: sample "${voice.id}" dropped: the sample library was still loading when it was due`);
    }
    this.#waiting = keep;
    if (keep.length > 0) this.#deadline = setTimeout(() => this.#dropWaiting(), LATE_MS);
  }

  /**
   * Call from a user gesture's handler: the press and the release both call
   * it, since iOS counts only a touch's end as the gesture that unlocks audio.
   */
  enable(): void {
    playThroughSilentSwitch();
    if (this.#context === undefined) this.#context = new AudioContext();
    const context = this.#context;
    if (context.state === "running") return;
    void context.resume();
    // Older iOS unlocks only once a sound starts inside the gesture: one silent sample.
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, SAMPLE_RATE);
    source.connect(context.destination);
    source.start();
  }

  play(voice: Voice): void {
    const context = this.#context;
    if (context === undefined) {
      if (!this.#skipped) this.#log("canvas-loop: sound starts after the first click or key press on the figure");
      this.#skipped = true;
      return;
    }
    let library: SampleLibrary | undefined;
    if (voice.kind === "sample") {
      if (this.#library === "failed") return;
      if (this.#library === "loading") {
        this.#waiting.push({ voice, due: performance.now() });
        this.#deadline ??= setTimeout(() => this.#dropWaiting(), LATE_MS + 1);
        return;
      }
      library = this.#library;
    }
    // Rendered at the fixed rate the headless WAV uses; the browser resamples for the device.
    const samples = renderVoice(voice, { sampleRate: SAMPLE_RATE, library });
    const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.addEventListener("ended", () => this.#playing.delete(source));
    this.#playing.add(source);
    source.start();
  }

  /** Stop every sounding voice (restart). */
  stopAll(): void {
    this.#waiting = [];
    clearTimeout(this.#deadline);
    this.#deadline = undefined;
    for (const source of this.#playing) source.stop();
    this.#playing.clear();
  }

  /** Release the audio device (teardown). */
  close(): void {
    this.#closed = true;
    this.stopAll();
    void this.#context?.close();
    this.#context = undefined;
  }
}

/**
 * On iPhone, Web Audio is muted by the silent switch unless the page's audio
 * session is "playback" (as a video's is). Safari 16.4+ has
 * `navigator.audioSession`; elsewhere this does nothing.
 */
function playThroughSilentSwitch(): void {
  if (typeof navigator === "undefined") return;
  const session: unknown = Reflect.get(navigator, "audioSession");
  if (typeof session === "object" && session !== null) Reflect.set(session, "type", "playback");
}
