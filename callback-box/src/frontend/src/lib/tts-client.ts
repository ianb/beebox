/**
 * TTS client for chat speech output.
 * Fetches audio from the backend proxy (/api/chat/tts) and plays it.
 * Uses shared pre-unlocked Audio element for iOS Safari compatibility.
 */

import { getApiBase } from "../api";
import { playAudioBlob } from "./audio-context";
import { VALID_VOICES, type TTSVoice } from "./speech-parsing";

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
  private abortController: AbortController | null = null;
  private onPlayingChange?: (playing: boolean) => void;
  private voiceConfig: VoiceConfig = {
    voice: DEFAULT_VOICE,
    baseInstructions: DEFAULT_INSTRUCTIONS,
  };

  private buildInstructions(custom?: string, overrideBase?: boolean): string {
    if (overrideBase && custom) return custom;
    return custom
      ? `${this.voiceConfig.baseInstructions} ${custom}`
      : this.voiceConfig.baseInstructions;
  }

  private resolveVoice(perSpeechVoice?: TTSVoice): string {
    if (perSpeechVoice && (VALID_VOICES as readonly string[]).includes(perSpeechVoice)) {
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

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.currentStop) {
      this.currentStop();
      this.currentStop = null;
    }
    const pending = this.queue.splice(0);
    for (const item of pending) {
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
    const instructions = this.buildInstructions(
      item.options?.instructions,
      item.options?.overrideInstructions,
    );
    const voice = this.resolveVoice(item.options?.voice);

    this.abortController = new AbortController();
    const response = await fetch(`${getApiBase()}/chat/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: item.text, instructions, voice }),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`TTS API error ${response.status}: ${err}`);
    }

    const buffer = await this.readStreamToBuffer(response);
    const { stop, finished } = playAudioBlob(buffer);
    this.currentStop = stop;
    await finished;
    this.currentStop = null;
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
