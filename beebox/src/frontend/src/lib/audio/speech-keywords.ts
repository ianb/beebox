import { KeywordPattern, type InputMatch } from "../patmatch/keyword-pattern";

const sendPattern = KeywordPattern.compile(`
  (send | sent | same | deliver | finished | finish | said) (a | the | an)? message
  it's (a | the | an)? message
  message (done | finished)
  send now
`);

// Deliberate HQ fixup: unlike plain send, this asks the caller to hold the
// message for the high-quality transcription pass before committing it. Both
// word orders are explicit enough to avoid ordinary-speech false positives.
const sendHqPattern = KeywordPattern.compile(`
  clean up and send
  send and clean up
`);

// "Send and close": send the message, then close the mic and leave it closed
// (the deliberate "I'm done, take it from here" sign-off), in contrast to plain
// `send`, which restarts the mic for a continuous conversation. Checked FIRST in
// detectKeyword — it owns the "send and …" / "over and out" shape, which overlaps
// both plain `send` ("send and finish the message" → `finish … message`) and
// micOff ("send and stop the mic" / "send and close the mic" → `stop the mic` /
// `close the mic`); the close variant wins both. "Over and out" is the taught
// phrase: an idiom the transcriber restores reliably, where "send and close"
// is often heard as "set a closed".
const sendClosePattern = KeywordPattern.compile(`
  over and out
  send and (close | stop | finish | finished | done | sign off)
  send and close (the)? (mic | microphone | message)
  set a closed (the)? (mic | microphone | message)
`);

// "Send checkpoint": the same client action as plain `send` (send, re-arm the
// mic), but the agent gets its own tag meaning "partial — I am still talking".
// Always two words with "checkpoint", so talking ABOUT checkpoints ("add a
// checkpoint before the deploy") does not fire; only the send verbs take an
// article.
const sendCheckpointPattern = KeywordPattern.compile(`
  (send | sent) (a | the)? checkpoint (message)?
  (commit | add) checkpoint
`);

const cancelPattern = KeywordPattern.compile(`
  (cancel | abort | nevermind) (a | the | an)? (message | microphone)
  (message | microphone) (cancel | abort | nevermind)
`);

const micOffPattern = KeywordPattern.compile(`
  microphone off
  mic off
  turn off (the)? (microphone | mic)
  stop (the)? (microphone | mic)
  close (the)? (microphone | mic)
  mute (the)? (microphone | mic)
  stop listening
  pause listening
`);

const erasePattern = KeywordPattern.compile(`
  erase (the | a | my)? message
  clear (the | a | my)? message
  start over
`);

export type KeywordAction = "send" | "sendHq" | "sendClose" | "sendCheckpoint" | "cancel" | "micOff" | "erase";

/** The send variants whose tag a persisted voice message carries (HQ shares plain send's). */
export type SendKeywordAction = "send" | "sendClose" | "sendCheckpoint";

export interface KeywordResult {
  action: KeywordAction;
  processedTranscript: string;
  matchedPhrase: string;
}

export interface DetectKeywordOptions {
  /**
   * Only return matches that begin at the start of the transcript (no
   * preceding words). Useful for matching against the live (interim)
   * transcript, where command words mid-utterance are usually false
   * positives.
   */
  atStart?: boolean;
}

const ACTION_TAG_NAMES: Record<KeywordAction, string> = {
  send: "send-message",
  // HQ is preparation for a normal send, not a distinct agent-side command.
  sendHq: "send-message",
  sendClose: "send-close-message",
  sendCheckpoint: "send-checkpoint-message",
  cancel: "cancel-message",
  micOff: "mic-off",
  erase: "erase-message",
};

/**
 * Remove keyword control tags from text headed back into the composer. The
 * tags are markers for the persisted message record, not composer content —
 * a rejected send's restore must return the user's words, never raw markup
 * (the iOS composer holds substitution until its send lock accepts for the
 * same reason; docs/mobile-contract.md §4.4).
 */
export function stripKeywordTags(text: string): string {
  // Literal alternation of ACTION_TAG_NAMES' values (the lint bans a
  // constructed RegExp); the doctest strips every action's tag, so a new
  // action name added without extending this pattern fails there.
  return text.replace(/\s*<(?:send-message|send-close-message|send-checkpoint-message|cancel-message|mic-off|erase-message)\b[^<>]*\/>/g, "").trim();
}

function keywordTag(action: KeywordAction, phrase: string): string {
  const escaped = phrase.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<${ACTION_TAG_NAMES[action]} phrase="${escaped}" />`;
}

function asResult(action: KeywordAction, match: InputMatch): KeywordResult {
  return {
    action,
    processedTranscript: match.replaceTrimmed(keywordTag(action, match.capturedTextTrimmed)).trim(),
    matchedPhrase: match.capturedTextTrimmed,
  };
}

/**
 * Re-attach a send keyword that the high-quality transcription pass dropped.
 * The realtime pass already heard the trigger phrase (that's what fired the
 * send), so an HQ result without it means the normalizer smoothed the phrase
 * away — append the tag rather than lose the trigger. A duplicate trigger is
 * harmless; a silently vanished one isn't. `action` carries the send variant
 * so the persisted record keeps the close sign-off or the checkpoint.
 */
export function appendSendKeywordTag(
  transcript: string,
  { action, matchedPhrase }: { action: SendKeywordAction; matchedPhrase: string }
): string {
  return `${transcript.trim()} ${keywordTag(action, matchedPhrase)}`.trim();
}

/**
 * The send-keyword tag a transcript already carries — the inverse of
 * {@link appendSendKeywordTag} — so a voice send restored after a reload can
 * put the same tag on its HQ text. Null when the transcript has none.
 */
export function sendKeywordIn(transcript: string): { action: SendKeywordAction; matchedPhrase: string } | null {
  const match = /<(send-message|send-close-message|send-checkpoint-message) phrase="([^"]*)" \/>/.exec(transcript);
  if (!match) return null;
  const [, tag, escaped] = match;
  const matchedPhrase = (escaped ?? "").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
  const action: SendKeywordAction = tag === "send-close-message" ? "sendClose" : tag === "send-checkpoint-message" ? "sendCheckpoint" : "send";
  return { action, matchedPhrase };
}

export function detectKeyword(
  transcript: string,
  options?: DetectKeywordOptions
): KeywordResult | null {
  const atStart = !!options?.atStart;
  const tryMatch = (pattern: KeywordPattern): InputMatch | null => {
    const match = pattern.match(transcript);
    if (!match) return null;
    if (atStart && match.leading.length > 0) return null;
    return match;
  };

  // Checked first. Its patterns only match "send and …" and "over and out",
  // which no other keyword contains, so leading steals nothing — and it has to win over the overlaps: plain `send` ("send and
  // finish the message" → also `finish … message`) and micOff ("send and stop
  // / close the mic" → also `stop the mic` / `close the mic`). Those should
  // send-and-close, not just send / just mute.
  const sendCloseMatch = tryMatch(sendClosePattern);
  if (sendCloseMatch) return asResult("sendClose", sendCloseMatch);

  // No other pattern contains "checkpoint", so order does not matter here; it
  // sits with the other send variants.
  const sendCheckpointMatch = tryMatch(sendCheckpointPattern);
  if (sendCheckpointMatch) return asResult("sendCheckpoint", sendCheckpointMatch);

  const sendHqMatch = tryMatch(sendHqPattern);
  if (sendHqMatch) return asResult("sendHq", sendHqMatch);

  const micOffMatch = tryMatch(micOffPattern);
  if (micOffMatch) return asResult("micOff", micOffMatch);

  const cancelMatch = tryMatch(cancelPattern);
  if (cancelMatch) return asResult("cancel", cancelMatch);

  const eraseMatch = tryMatch(erasePattern);
  if (eraseMatch) return asResult("erase", eraseMatch);

  const sendMatch = tryMatch(sendPattern);
  if (sendMatch) return asResult("send", sendMatch);

  return null;
}
