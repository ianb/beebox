// Plays a figure's voices. Each voice is rendered by the same synth the
// headless WAV uses, so a voice sounds the same in both. A voice starts when
// the runtime reaches its frame; nothing is scheduled ahead, so pause and
// catch-up cannot drift. Browsers allow audio only after a user gesture:
// `enable()` runs on the first pointer or key press, before that input is
// dispatched, so its own sound plays. Voices before it are skipped.
import { SAMPLE_RATE, renderVoice } from "../../core/sound/synth.js";
import type { Voice } from "../../core/sound/voice.js";

export class SoundPlayer {
  #context: AudioContext | undefined;
  #playing = new Set<AudioBufferSourceNode>();
  #skipped = false;
  #log: (message: string) => void;

  constructor(log: (message: string) => void) {
    this.#log = log;
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
    // Rendered at the fixed rate the headless WAV uses; the browser resamples for the device.
    const samples = renderVoice(voice, SAMPLE_RATE);
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
    for (const source of this.#playing) source.stop();
    this.#playing.clear();
  }

  /** Release the audio device (teardown). */
  close(): void {
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
