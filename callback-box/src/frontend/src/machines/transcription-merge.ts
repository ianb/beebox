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

/** Prepend words committed by prior connections in this segment. */
export function mergeFinalWords(committedWords: FinalWord[], words: FinalWord[]): FinalWord[] {
  if (committedWords.length === 0) return words;
  return [...committedWords, ...words];
}
