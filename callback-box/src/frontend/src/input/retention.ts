/**
 * RetentionStore — emission-keyed audio retention (docs/plans/
 * input-extraction.md, chunk 5). Replaces the old single-slot
 * `lib/last-audio-cache.ts`: instead of one "last recording" variable that
 * every send implicitly clears (the wart chunk 5 removes — see
 * `InteractiveChat-dispatch.ts`), each voice send's recording is retained
 * under its own emission id (the wire `messageId`). "Latest" is then just
 * "the most recently retained entry," well-defined by construction — no
 * clearing required.
 *
 * Generic over the payload (`Audio`) so this module stays framework-free
 * (input/ rule: no React or DOM types in the interface). The one caller
 * that actually retains audio (`lib/last-audio.ts`) instantiates
 * `createRetentionStore<VoiceAudioPayload>` where `VoiceAudioPayload`
 * carries a `Blob` — that Blob crosses by reference, the same way
 * `EmissionFile` carries a file by path rather than by content. It is
 * never converted to base64/ArrayBuffer: the audio never serializes
 * anywhere (it lives only in this tab's memory, exactly like the old
 * single-slot cache, until `fulfillLastAudioRequest` uploads it via
 * `FormData`), so a decode/encode round trip through base64 would add
 * cost for no benefit. `retention.ts` itself never names `Blob` — it's
 * opaque cargo as far as this module is concerned.
 *
 * v1 policy (settled in the plan): memory-only, capacity 5, oldest evicted
 * first. The interface doesn't bake that policy in — a future change
 * (e.g. IndexedDB, a different N) only touches the instantiation site.
 */

export interface RetentionStore<Audio> {
  /** Retain `audio` under `emissionId`, evicting the oldest entry if this pushes past capacity. */
  retain(emissionId: string, audio: Audio): void;
  /** The entry retained for `emissionId`, or `undefined` if none (evicted, or never retained). */
  get(emissionId: string): Audio | undefined;
  /** The most recently retained entry, or `undefined` if the store is empty. */
  latest(): { emissionId: string; audio: Audio } | undefined;
  /** Current entry count (never exceeds `capacity`). */
  size(): number;
}

/**
 * A framework-free, in-memory `RetentionStore`. Backed by a `Map`, whose
 * iteration order is insertion order — retaining under an id already
 * present moves it to the end (most-recent), and eviction always drops the
 * first (oldest) key once size exceeds `capacity`.
 */
export function createRetentionStore<Audio>(opts: { capacity: number }): RetentionStore<Audio> {
  const { capacity } = opts;
  const entries = new Map<string, Audio>();

  return {
    retain(emissionId, audio) {
      entries.delete(emissionId); // re-retaining an id moves it to most-recent
      entries.set(emissionId, audio);
      while (entries.size > capacity) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) break;
        entries.delete(oldestKey);
      }
    },
    get(emissionId) {
      return entries.get(emissionId);
    },
    latest() {
      let lastKey: string | undefined;
      let lastAudio: Audio | undefined;
      for (const [key, audio] of entries) {
        lastKey = key;
        lastAudio = audio;
      }
      if (lastKey === undefined || lastAudio === undefined) return;
      return { emissionId: lastKey, audio: lastAudio };
    },
    size() {
      return entries.size;
    },
  };
}
