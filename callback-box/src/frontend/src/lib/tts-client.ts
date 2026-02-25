/**
 * TTS client for chat speech output.
 * Fetches audio from the backend proxy (/api/chat/tts) and plays it.
 * Adapted from thinking-machine tts.ts + ttsStream.ts.
 */

import { getApiBase } from "../api";

const BASE_INSTRUCTIONS = "Fast and concise, but with a friendly lilting tone.";

interface SpeechQueueItem {
  text: string;
  instructions?: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

class TTSClient {
  private queue: SpeechQueueItem[] = [];
  private playing = false;
  private currentAudio: HTMLAudioElement | null = null;
  private abortController: AbortController | null = null;
  private onPlayingChange?: (playing: boolean) => void;

  private buildInstructions(custom?: string): string {
    return custom ? `${BASE_INSTRUCTIONS} ${custom}` : BASE_INSTRUCTIONS;
  }

  setOnPlayingChange(callback: (playing: boolean) => void): void {
    this.onPlayingChange = callback;
  }

  async speak(text: string, customInstructions?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ text, instructions: customInstructions, resolve, reject });
      this.processQueue();
    });
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = "";
      this.currentAudio = null;
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
    const instructions = this.buildInstructions(item.instructions);

    console.log("[TTS] Generating speech:", item.text.slice(0, 50), "...");

    this.abortController = new AbortController();
    const response = await fetch(`${getApiBase()}/chat/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: item.text, instructions }),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`TTS API error ${response.status}: ${err}`);
    }

    await this.playAudioFromResponse(response);
  }

  private async playAudioFromResponse(response: Response): Promise<void> {
    const buffer = await this.readStreamToBuffer(response);
    const blob = new Blob([buffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      this.currentAudio = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        resolve();
      };

      audio.onerror = (e) => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        reject(new Error(`Audio playback error: ${e}`));
      };

      audio.play().catch(reject);
    });
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
