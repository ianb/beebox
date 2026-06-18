import { KeywordPattern, type InputMatch } from "./patmatch";

const sendPattern = KeywordPattern.compile(`
  (send | sent | deliver | finished | finish | said) (a | the | an)? message
  it's (a | the | an)? message
  message (done | finished)
  send now
`);

// "Send and close": send the message, then close the mic and leave it closed
// (the deliberate "I'm done, take it from here" sign-off), in contrast to plain
// `send`, which restarts the mic for a continuous conversation. Checked BEFORE
// `sendPattern` in detectKeyword — phrases like "send and finish the message"
// also satisfy the plain-send pattern (`finish … message`), so the close
// variant has to win the overlap.
const sendClosePattern = KeywordPattern.compile(`
  send and (close | stop | finish | done | sign off)
  send and close (the)? (mic | microphone | message)
  over and out
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
  stop listening
`);

const erasePattern = KeywordPattern.compile(`
  erase (the | a | my)? message
  clear (the | a | my)? message
  start over
`);

export type KeywordAction = "send" | "sendClose" | "cancel" | "micOff" | "erase";

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
  sendClose: "send-close-message",
  cancel: "cancel-message",
  micOff: "mic-off",
  erase: "erase-message",
};

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
 * (`send` vs `sendClose`) so the persisted record reflects the close sign-off.
 */
export function appendSendKeywordTag(
  transcript: string,
  { action, matchedPhrase }: { action: "send" | "sendClose"; matchedPhrase: string }
): string {
  return `${transcript.trim()} ${keywordTag(action, matchedPhrase)}`.trim();
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

  const micOffMatch = tryMatch(micOffPattern);
  if (micOffMatch) return asResult("micOff", micOffMatch);

  const cancelMatch = tryMatch(cancelPattern);
  if (cancelMatch) return asResult("cancel", cancelMatch);

  const eraseMatch = tryMatch(erasePattern);
  if (eraseMatch) return asResult("erase", eraseMatch);

  // Must precede plain `send`: "send and finish the message" matches both, and
  // the close variant has to win (see sendClosePattern).
  const sendCloseMatch = tryMatch(sendClosePattern);
  if (sendCloseMatch) return asResult("sendClose", sendCloseMatch);

  const sendMatch = tryMatch(sendPattern);
  if (sendMatch) return asResult("send", sendMatch);

  return null;
}
