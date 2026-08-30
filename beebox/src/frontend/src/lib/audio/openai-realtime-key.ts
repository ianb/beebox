/**
 * Browser-side OpenAI Realtime ephemeral-key manager.
 *
 * Calls the server's transcription.openaiRealtimeKey tRPC procedure to mint
 * a short-TTL client secret (`ek_...`) tied to a transcription session
 * config. OpenAI ephemeral tokens expire after ~1 minute, so we cache only
 * briefly and re-mint per recording.
 */

import { trpcClient } from "../trpc";

const SAFETY_MARGIN_MS = 10 * 1000;

interface CachedKey {
  key: string;
  expiresAt: number;
}

class OpenAIRealtimeKeyManager {
  private cached: CachedKey | null = null;
  private inflight: Promise<string> | null = null;

  async getKey(): Promise<string> {
    const now = Date.now();
    if (this.cached && now < this.cached.expiresAt - SAFETY_MARGIN_MS) {
      return this.cached.key;
    }
    if (this.inflight) {
      return this.inflight;
    }
    this.inflight = (async () => {
      try {
        const result = await trpcClient.transcription.openaiRealtimeKey.mutate();
        this.cached = {
          key: result.key,
          expiresAt: Date.now() + result.ttlSeconds * 1000,
        };
        return result.key;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}

export const openaiRealtimeKeyManager = new OpenAIRealtimeKeyManager();
