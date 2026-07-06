/**
 * Browser-side Deepgram temp-key manager.
 *
 * Calls the server's transcription.deepgramTempKey tRPC procedure to mint a
 * short-TTL key with usage:write scope. Caches the key in memory until it's
 * close to expiring; the next caller triggers a refresh.
 *
 * Adapted from the memory-atlas DeepgramKeyManager pattern.
 */

import { trpcClient } from "../trpc";

const SAFETY_MARGIN_MS = 30 * 1000;

interface CachedKey {
  key: string;
  expiresAt: number;
}

class DeepgramKeyManager {
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
        const result = await trpcClient.transcription.deepgramTempKey.mutate();
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

export const deepgramKeyManager = new DeepgramKeyManager();
