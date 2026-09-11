/**
 * Which live transcription service a segment connects to
 * (`docs/plans/resilient-voice-recording.md`, Track 3). The last-known
 * choice is cached per box in `localStorage`: a segment that starts while
 * the box is restarting would otherwise block its live preview on the config
 * query; with a cached choice it tries the socket at once while the query
 * refreshes the cache in the background.
 */

import { getApiBase } from "../../api-core";
import { trpcClient } from "../trpc";
import { TRANSCRIPTION_SERVICES, type TranscriptionService } from "@shared/transcription-services.js";

/** Keyed by the box's API base, which carries the box slug (and dev worktree). */
function storageKey(): string {
  return `bbx:transcription-service:${getApiBase()}`;
}

function readCachedTranscriptionService(): TranscriptionService | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storageKey());
  } catch (e) {
    console.warn("[realtime-transcription] Cannot read the cached transcription service:", e);
    return null;
  }
  // Parse boundary: anything not a known service reads as "no cache".
  return TRANSCRIPTION_SERVICES.find((service) => service === raw) ?? null;
}

function writeCachedTranscriptionService(service: TranscriptionService): void {
  try {
    window.localStorage.setItem(storageKey(), service);
  } catch (e) {
    console.warn("[realtime-transcription] Cannot cache the transcription service:", e);
  }
}

/** Resolves (and caches) the live service for one segment. */
export class TranscriptionServiceResolver {
  private service: TranscriptionService | null = null;

  /**
   * The cached choice if there is one (a background query refreshes it for
   * the next attempt), otherwise the query itself. Null when the box can't be
   * asked and nothing is cached — the caller retries.
   */
  async resolve(): Promise<TranscriptionService | null> {
    if (this.service !== null) return this.service;
    const cached = readCachedTranscriptionService();
    if (cached === null) return this.refresh();
    this.service = cached;
    // refresh() catches and logs its own failures; nothing to await here.
    void this.refresh();
    return cached;
  }

  private async refresh(): Promise<TranscriptionService | null> {
    try {
      const config = await trpcClient.transcription.config.query();
      writeCachedTranscriptionService(config.service);
      this.service = config.service;
      return config.service;
    } catch (e) {
      console.warn("[realtime-transcription] transcription config unavailable; still recording:", e);
      return null;
    }
  }
}
