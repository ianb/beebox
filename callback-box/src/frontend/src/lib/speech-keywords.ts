import { KeywordPattern } from "./patmatch";

const sendPattern = KeywordPattern.compile(`
  (send | deliver | finished | finish) (a | the | an)? message
  message (done | finished)
  send now
  finished
  finish
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

export function detectKeyword(transcript: string): KeywordResult | null {
  const micOffMatch = micOffPattern.match(transcript);
  if (micOffMatch) {
    return {
      action: "micOff",
      processedTranscript: micOffMatch.replaceTrimmed(keywordTag("micOff", micOffMatch.capturedTextTrimmed)).trim(),
      matchedPhrase: micOffMatch.capturedTextTrimmed,
    };
  }

  const cancelMatch = cancelPattern.match(transcript);
  if (cancelMatch) {
    return {
      action: "cancel",
      processedTranscript: cancelMatch.replaceTrimmed(keywordTag("cancel", cancelMatch.capturedTextTrimmed)).trim(),
      matchedPhrase: cancelMatch.capturedTextTrimmed,
    };
  }

  const eraseMatch = erasePattern.match(transcript);
  if (eraseMatch) {
    return {
      action: "erase",
      processedTranscript: eraseMatch.replaceTrimmed(keywordTag("erase", eraseMatch.capturedTextTrimmed)).trim(),
      matchedPhrase: eraseMatch.capturedTextTrimmed,
    };
  }

  const sendMatch = sendPattern.match(transcript);
  if (sendMatch) {
    return {
      action: "send",
      processedTranscript: sendMatch.replaceTrimmed(keywordTag("send", sendMatch.capturedTextTrimmed)).trim(),
      matchedPhrase: sendMatch.capturedTextTrimmed,
    };
  }

  return null;
}
