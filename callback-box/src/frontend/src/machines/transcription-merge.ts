/**
 * Pure reconnect-merge helpers for `transcription-actor.ts`'s
 * `TranscriptionSession`. Each Deepgram/OpenAI connection emits its own
 * session's full-accumulated `finalText`/`finalWords` from scratch (replace,
 * not append); a reconnect opens a fresh, empty-start session, so the prior
 * connection's confirmed text/words are folded into a "committed" prefix and
 * prepended to everything the new session emits.
 *
 * `mergeFinalWords` mirrors `mergeFinalText` exactly — same shape, called at
 * the identical point in the reconnect flow (`TranscriptionSession.mergeFinal`
 * / `mergeWords`, and `beginReconnect`'s prefix fold) — so the word list can
 * never drift out of step with the text it describes (the reconnect
 * direction detail in `docs/plans/transcript-confidence.md`, Track 2).
 */

import type { FinalWord } from "./transcription-events";

/** Prepend text committed by prior connections in this segment. */
export function mergeFinalText(committedPrefix: string, text: string): string {
  if (!committedPrefix) return text;
  if (!text) return committedPrefix;
  return `${committedPrefix} ${text}`;
}

/**
 * Prepend words committed by prior connections in this segment. `null` on
 * both sides means no service has ever attached word data to this segment
 * (Voxtral/OpenAI, or nothing finalized yet) and stays `null` — merging
 * "no data" with "no data" must not manufacture a `[]` that looks captured
 * (Track 3 review fix, Fix A). Either side actually holding words wins.
 */
export function mergeFinalWords(
  committedWords: FinalWord[] | null,
  words: FinalWord[] | null,
): FinalWord[] | null {
  if (committedWords === null && words === null) return null;
  return [...(committedWords ?? []), ...(words ?? [])];
}
