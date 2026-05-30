import { KeywordPattern, type InputMatch } from "./patmatch";

const sendPattern = KeywordPattern.compile(`
  (send | sent | deliver | finished | finish | said) (a | the | an)? message
  it's (a | the | an)? message
  message (done | finished)
  send now
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

export type KeywordAction = "send" | "cancel" | "micOff" | "erase";

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

  const sendMatch = tryMatch(sendPattern);
  if (sendMatch) return asResult("send", sendMatch);

  return null;
}
