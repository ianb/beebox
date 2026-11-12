// Plays a figure's voices. Each voice is rendered by the same synth the
// headless WAV uses, so a voice sounds the same in both. A voice starts when
// the runtime reaches its frame; nothing is scheduled ahead, so pause and
// catch-up cannot drift. Browsers allow audio only after a user gesture:
// `enable()` runs on the first pointer or key press, before that input is
// dispatched, so its own sound plays. Voices before it are skipped.
import { renderVoice } from "../../core/sound/synth.js";
import type { Voice } from "../../core/sound/voice.js";

export class SoundPlayer {
  #context: AudioContext | undefined;
  #playing = new Set<AudioBufferSourceNode>();
  #skipped = false;
  #log: (message: string) => void;

  constructor(log: (message: string) => void) {
    this.#log = log;
  }

  /** Call from a user gesture's handler. */
  enable(): void {
    if (this.#context === undefined) this.#context = new AudioContext();
    if (this.#context.state === "suspended") void this.#context.resume();
  }

  play(voice: Voice): void {
    const context = this.#context;
    if (context === undefined) {
      if (!this.#skipped) this.#log("canvas-loop: sound starts after the first click or key press on the figure");
      this.#skipped = true;
      return;
    }
    const samples = renderVoice(voice, context.sampleRate);
    const buffer = context.createBuffer(1, samples.length, context.sampleRate);
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
