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

export function detectKeyword(transcript: string): KeywordResult | null {
  console.log("[speech-keywords] detectKeyword called with:", JSON.stringify(transcript));

  const micOffMatch = micOffPattern.match(transcript);
  if (micOffMatch) {
    console.log("[speech-keywords] MIC_OFF match:", micOffMatch.capturedTextTrimmed);
    return {
      action: "micOff",
      processedTranscript: micOffMatch.replaceTrimmed("").trim(),
      matchedPhrase: micOffMatch.capturedTextTrimmed,
    };
  }

  const cancelMatch = cancelPattern.match(transcript);
  if (cancelMatch) {
    console.log("[speech-keywords] CANCEL match:", cancelMatch.capturedTextTrimmed);
    return {
      action: "cancel",
      processedTranscript: cancelMatch.replaceTrimmed("").trim(),
      matchedPhrase: cancelMatch.capturedTextTrimmed,
    };
  }

  const eraseMatch = erasePattern.match(transcript);
  if (eraseMatch) {
    console.log("[speech-keywords] ERASE match:", eraseMatch.capturedTextTrimmed);
    return {
      action: "erase",
      processedTranscript: eraseMatch.replaceTrimmed("").trim(),
      matchedPhrase: eraseMatch.capturedTextTrimmed,
    };
  }

  const sendMatch = sendPattern.match(transcript);
  console.log("[speech-keywords] send match result:", sendMatch ? sendMatch.capturedTextTrimmed : "null");
  if (sendMatch) {
    return {
      action: "send",
      processedTranscript: sendMatch.replaceTrimmed("").trim(),
      matchedPhrase: sendMatch.capturedTextTrimmed,
    };
  }

  return null;
}
