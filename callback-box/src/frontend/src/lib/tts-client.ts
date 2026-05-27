/**
 * TTS client for chat speech output.
 * Fetches audio from the backend proxy (/api/chat/tts) and plays it.
 * Uses shared pre-unlocked Audio element for iOS Safari compatibility.
 */

import { getApiBase } from "../api";
import { playAudioBlob } from "./audio-context";
import { isTTSVoice, type TTSVoice } from "./speech-parsing";

const DEFAULT_VOICE: TTSVoice = "marin";
const DEFAULT_INSTRUCTIONS = "Fast and concise, but with a friendly lilting tone.";

export interface VoiceConfig {
  voice: TTSVoice;
  baseInstructions: string;
}

interface SpeechOptions {
  instructions?: string;
  voice?: TTSVoice;
  overrideInstructions?: boolean;
  prefetch?: PrefetchHandle;
}

export interface PrefetchHandle {
  buffer: Promise<ArrayBuffer>;
  abort: () => void;
}

interface SpeechQueueItem {
  text: string;
  options?: SpeechOptions;
  resolve: () => void;
  reject: (error: Error) => void;
}

class TTSClient {
  private queue: SpeechQueueItem[] = [];
  private playing = false;
  private currentStop: (() => void) | null = null;
  private currentAbort: (() => void) | null = null;
  private onPlayingChange?: (playing: boolean) => void;
  private voiceConfig: VoiceConfig = {
    voice: DEFAULT_VOICE,
    baseInstructions: DEFAULT_INSTRUCTIONS,
  };
  // Resolved once the personality's voice config has loaded (or failed to
  // load). fetchAudio/prefetch await this so the first utterance after
  // page load can't slip out with the default voice. Callers must invoke
  // markConfigLoaded() exactly once, regardless of fetch success.
  private configReady: Promise<void>;
  private markConfigReady!: () => void;

  constructor() {
    this.configReady = new Promise((resolve) => {
      this.markConfigReady = resolve;
    });
  }

  /**
   * Signal that voice-config loading is finished (either applied or
   * fallback). Safe to call multiple times — subsequent calls are no-ops.
   */
  markConfigLoaded(): void {
    this.markConfigReady();
  }

  private buildInstructions(custom?: string, overrideBase?: boolean): string {
    if (overrideBase && custom) return custom;
    return custom
      ? `${this.voiceConfig.baseInstructions} ${custom}`
      : this.voiceConfig.baseInstructions;
  }

  private resolveVoice(perSpeechVoice?: TTSVoice): string {
    if (perSpeechVoice && isTTSVoice(perSpeechVoice)) {
      return perSpeechVoice;
    }
    return this.voiceConfig.voice;
  }

  /**
   * Update voice configuration (called when personality config loads).
   */
  setVoiceConfig(config: Partial<VoiceConfig>): void {
    if (config.voice) this.voiceConfig.voice = config.voice;
    if (config.baseInstructions !== undefined) {
      this.voiceConfig.baseInstructions = config.baseInstructions;
    }
  }

  getVoiceConfig(): VoiceConfig {
    return { ...this.voiceConfig };
  }

  setOnPlayingChange(callback: (playing: boolean) => void): void {
    this.onPlayingChange = callback;
  }

  async speak(text: string, options?: SpeechOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ text, options, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Start fetching audio for an upcoming speak() call. Returns a handle whose
   * `.buffer` resolves to the raw audio data. Pass the handle to speak() to
   * play the prefetched buffer instead of re-fetching.
   */
  prefetch(text: string, options?: SpeechOptions): PrefetchHandle {
    const ac = new AbortController();
    const buffer = this.fetchAudio(text, { options, signal: ac.signal });
    // Avoid an unhandled rejection if the prefetch is aborted before any
    // speak() consumer attaches to the promise.
    buffer.catch(() => { /* swallow; consumer will see the rejection if it awaits */ });
    return {
      buffer,
      abort: () => ac.abort(),
    };
  }

  stop(): void {
    if (this.currentAbort) {
      this.currentAbort();
      this.currentAbort = null;
    }
    if (this.currentStop) {
      this.currentStop();
      this.currentStop = null;
    }
    const pending = this.queue.splice(0);
    for (const item of pending) {
      item.options?.prefetch?.abort();
      item.reject(new Error("Playback stopped"));
    }
    this.setPlaying(false);
  }

  getIsPlaying(): boolean {
    return this.playing;
  }

  private setPlaying(value: boolean): void {
    this.playing = value;
    this.onPlayingChange?.(value);
  }

  private async processQueue(): Promise<void> {
    if (this.playing || this.queue.length === 0) return;

    const item = this.queue.shift()!;
    this.setPlaying(true);

    try {
      await this.playItem(item);
      item.resolve();
    } catch (error) {
      console.error("[TTS] Playback error:", error);
      item.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.setPlaying(false);
      this.processQueue();
    }
  }

  private async playItem(item: SpeechQueueItem): Promise<void> {
    const prefetch = item.options?.prefetch;
    let buffer: ArrayBuffer;
    if (prefetch) {
      this.currentAbort = prefetch.abort;
      buffer = await prefetch.buffer;
    } else {
      const ac = new AbortController();
      this.currentAbort = () => ac.abort();
      buffer = await this.fetchAudio(item.text, { options: item.options, signal: ac.signal });
    }
    this.currentAbort = null;

    const { stop, finished } = playAudioBlob(buffer);
    this.currentStop = stop;
    await finished;
    this.currentStop = null;
  }

  private async fetchAudio(
    text: string,
    { options, signal }: { options?: SpeechOptions; signal: AbortSignal },
  ): Promise<ArrayBuffer> {
    // Wait for personality voice config to load before reading
    // voiceConfig — otherwise the first utterance after page load uses
    // the hard-coded default.
    await this.configReady;
    const instructions = this.buildInstructions(
      options?.instructions,
      options?.overrideInstructions,
    );
    const voice = this.resolveVoice(options?.voice);

    const response = await fetch(`${getApiBase()}/chat/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, instructions, voice }),
      signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`TTS API error ${response.status}: ${err}`);
    }

    return this.readStreamToBuffer(response);
  }

  private async readStreamToBuffer(response: Response): Promise<ArrayBuffer> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty response body");

    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }

    const audioData = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      audioData.set(chunk, offset);
      offset += chunk.length;
    }
    return audioData.buffer as ArrayBuffer;
  }
}

let ttsClient: TTSClient | null = null;

export function getTTSClient(): TTSClient {
  if (!ttsClient) {
    ttsClient = new TTSClient();
  }
  return ttsClient;
}
