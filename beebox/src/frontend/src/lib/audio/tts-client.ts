/**
 * TTS client for chat speech output.
 * Fetches audio from the backend proxy (/api/chat/tts) and plays it.
 * Uses shared pre-unlocked Audio element for iOS Safari compatibility.
 *
 * Two performance properties matter here:
 *   - The head segment of a response streams into playback as it downloads
 *     (via playAudioStream / MediaSource) instead of waiting for the whole
 *     file, so the first sound starts as early as possible. Subsequent
 *     segments are prefetched in parallel by the playback machine.
 *   - Completed audio is cached in memory (see audio-cache) so replays don't
 *     re-hit the backend. Only fully-downloaded audio is cached.
 */

import { getApiBase } from "../../api";
import { playAudioBlob, playAudioStream, supportsMediaSource } from "./context";
import { getAudioCache, cacheKey } from "./cache";
import { DEFAULT_VOICE_CONFIG } from "./tts-types";
import { logSpeechEvent } from "./speech-test-log";
import { isTTSVoice, type TTSVoice } from "./speech-parsing";
import { RequestError } from "../errors";
import { invariant } from "@shared/invariant";
import type { PrefetchHandle, ResolvedSpeechKey, SpeechOptions, VoiceConfig } from "./tts-types";
import { PlaybackError, PlaybackStoppedError } from "./tts-errors";

export type { PrefetchHandle, VoiceConfig } from "./tts-types";


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
  private readonly cache = getAudioCache();
  // Extra request-body fields merged into every /chat/tts call. Empty in
  // normal use; the dev test harness sets mock/delay fields here so the
  // backend serves slow fixture audio instead of calling OpenAI.
  private testExtras: Record<string, unknown> = {};
  private voiceConfig: VoiceConfig = { ...DEFAULT_VOICE_CONFIG };
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

  /** Dev/test only: extra fields merged into every /chat/tts request body. */
  setTestRequestExtras(extras: Record<string, unknown>): void {
    this.testExtras = extras;
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
      // processQueue never rejects (its own try/catch routes failures to
      // item.reject instead) -- fire-and-forget queue drain.
      void this.processQueue();
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
      item.reject(new PlaybackStoppedError());
    }
    this.setPlaying(false);
  }

  /**
   * Fast-forward: end the segment currently playing so the playback machine
   * advances to the next queued one. Prefers stopping playback gracefully
   * (resolves the speak() promise → onDone advances); falls back to aborting
   * an in-flight fetch (rejects → onError skips ahead).
   */
  skipCurrent(): void {
    logSpeechEvent("skip", {});
    if (this.currentStop) {
      this.currentStop();
      this.currentStop = null;
      return;
    }
    if (this.currentAbort) {
      this.currentAbort();
      this.currentAbort = null;
    }
  }

  getIsPlaying(): boolean {
    return this.playing;
  }

  private setPlaying(value: boolean): void {
    this.playing = value;
    this.onPlayingChange?.(value);
  }

  private label(text: string): string {
    return text.slice(0, 16);
  }

  private async processQueue(): Promise<void> {
    if (this.playing || this.queue.length === 0) return;

    const item = this.queue.shift();
    invariant(item !== undefined, "processQueue only runs when the queue is non-empty");
    this.setPlaying(true);

    try {
      await this.playItem(item);
      item.resolve();
    } catch (error) {
      console.error("[TTS] Playback error:", error);
      item.reject(error instanceof Error ? error : new PlaybackError(String(error)));
    } finally {
      this.setPlaying(false);
      // Self-recursive drain of the next queued item; never rejects.
      void this.processQueue();
    }
  }

  private async playItem(item: SpeechQueueItem): Promise<void> {
    const prefetch = item.options?.prefetch;
    if (prefetch) {
      // Already (being) downloaded ahead of time; fetchAudio cached it.
      this.currentAbort = prefetch.abort;
      const buffer = await prefetch.buffer;
      this.currentAbort = null;
      await this.playBuffer(buffer, {
        text: item.text,
        onPlaybackStarted: item.options?.onPlaybackStarted,
      });
      return;
    }

    // On-demand head segment. Serve from cache, stream if we can, else
    // fall back to download-then-play.
    const resolved = await this.resolveKey(item.text, item.options);
    const cached = this.cache.get(resolved.key);
    if (cached) {
      logSpeechEvent("cacheHit", { label: this.label(item.text), key: resolved.key });
      await this.playBuffer(cached, {
        text: item.text,
        onPlaybackStarted: item.options?.onPlaybackStarted,
      });
      return;
    }

    if (supportsMediaSource()) {
      await this.streamAndPlay(item.text, {
        resolved,
        onPlaybackStarted: item.options?.onPlaybackStarted,
      });
      return;
    }

    const ac = new AbortController();
    this.currentAbort = () => ac.abort();
    const buffer = await this.fetchAudio(item.text, { options: item.options, signal: ac.signal });
    this.currentAbort = null;
    await this.playBuffer(buffer, {
      text: item.text,
      onPlaybackStarted: item.options?.onPlaybackStarted,
    });
  }

  private async playBuffer(
    buffer: ArrayBuffer,
    opts: { text: string; onPlaybackStarted?: () => void },
  ): Promise<void> {
    const { stop, finished } = playAudioBlob(
      buffer,
      { label: this.label(opts.text), onPlaying: opts.onPlaybackStarted },
    );
    this.currentStop = stop;
    try {
      await finished;
    } finally {
      this.currentStop = null;
    }
  }

  /**
   * Stream the head segment: start playing as chunks arrive, accumulate the
   * full buffer, and cache it once the download completes. A stop mid-download
   * leaves the buffer incomplete (null) so nothing partial is cached.
   */
  private async streamAndPlay(
    text: string,
    opts: { resolved: ResolvedSpeechKey; onPlaybackStarted?: () => void },
  ): Promise<void> {
    const label = this.label(text);
    const { resolved } = opts;
    const ac = new AbortController();
    this.currentAbort = () => ac.abort();
    logSpeechEvent("download.start", { label, streaming: true, key: resolved.key });

    const response = await fetch(`${getApiBase()}/chat/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: this.requestBody(text, resolved),
      signal: ac.signal,
    });
    if (!response.ok) {
      const err = await response.text();
      const message = `TTS API error ${response.status}: ${err}`;
      throw new RequestError(message);
    }
    this.currentAbort = null;

    const body = response.body;
    if (!body) {
      const message = "Empty response body";
      throw new RequestError(message);
    }

    const { stop, finished, buffer } = playAudioStream(
      body,
      { label, onPlaying: opts.onPlaybackStarted },
    );
    this.currentStop = stop;

    const full = await buffer;
    if (full) {
      this.cache.set(resolved.key, full);
      logSpeechEvent("download.complete", { label, key: resolved.key });
    }
    try {
      await finished;
    } finally {
      this.currentStop = null;
    }
  }

  private async resolveKey(text: string, options?: SpeechOptions): Promise<ResolvedSpeechKey> {
    // Wait for personality voice config to load before reading voiceConfig —
    // otherwise the first utterance after page load uses the hard-coded
    // default (and would be cached under the wrong key).
    await this.configReady;
    const instructions = this.buildInstructions(
      options?.instructions,
      options?.overrideInstructions,
    );
    const voice = this.resolveVoice(options?.voice);
    return { key: cacheKey({ text, voice, instructions, backend: this.voiceConfig.backend }), instructions, voice };
  }

  private requestBody(text: string, { instructions, voice }: { instructions: string; voice: string }): string {
    return JSON.stringify({ text, instructions, voice, ...this.testExtras });
  }

  private async fetchAudio(
    text: string,
    { options, signal }: { options?: SpeechOptions; signal: AbortSignal },
  ): Promise<ArrayBuffer> {
    const resolved = await this.resolveKey(text, options);
    const cached = this.cache.get(resolved.key);
    if (cached) {
      logSpeechEvent("cacheHit", { label: this.label(text), key: resolved.key });
      return cached;
    }

    logSpeechEvent("download.start", { label: this.label(text), key: resolved.key });
    const response = await fetch(`${getApiBase()}/chat/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: this.requestBody(text, resolved),
      signal,
    });

    if (!response.ok) {
      const err = await response.text();
      const message = `TTS API error ${response.status}: ${err}`;
      throw new RequestError(message);
    }

    const buffer = await this.readStreamToBuffer(response);
    this.cache.set(resolved.key, buffer);
    logSpeechEvent("download.complete", { label: this.label(text), key: resolved.key });
    return buffer;
  }

  private async readStreamToBuffer(response: Response): Promise<ArrayBuffer> {
    const reader = response.body?.getReader();
    if (!reader) {
      const message = "Empty response body";
      throw new RequestError(message);
    }

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
    // eslint-disable-next-line no-restricted-syntax -- Uint8Array.buffer is typed ArrayBufferLike, but this one was freshly allocated via `new Uint8Array(totalLength)` so it is always a plain ArrayBuffer.
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
