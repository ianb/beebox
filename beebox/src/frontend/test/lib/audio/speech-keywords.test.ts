// # Speech Keyword Detection
//
// `detectKeyword()` recognizes voice control commands in Whisper transcripts — things like "send message", "cancel", "microphone off". When a keyword is found, it's replaced with an XML tag in the transcript.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { detectKeyword, appendSendKeywordTag, sendKeywordIn } from "../../../src/lib/audio/speech-keywords.js";

// ## Send commands
//
// Several phrases trigger sending:
void test("Several phrases trigger sending:", async (t) => {
  // doctest:L14
  t.check(detectKeyword("send message")?.action, "send");

  // doctest:L17
  t.check(detectKeyword("sent message")?.action, "send");

  // doctest:L20
  t.check(detectKeyword("said message")?.action, "send");

  // doctest:L23
  t.check(detectKeyword("same message")?.action, "send");

  // doctest:L26
  t.check(detectKeyword("deliver the message")?.action, "send");

  // doctest:L29
  t.check(detectKeyword("message finished")?.action, "send");

  // doctest:L32
  t.check(detectKeyword("send now")?.action, "send");

  // doctest:L35
  t.check(detectKeyword("it's a message")?.action, "send");

  // doctest:L38
  t.check(detectKeyword("just a message")?.action, "send");
});

// Bare "finished" does NOT trigger send — too easy to hit in normal speech. It needs "message" adjacent:
void test("Bare \"finished\" does NOT trigger send — too easy to hit in normal speech.", async (t) => {
  // doctest:L45
  t.check(detectKeyword("finished"), null);

  // doctest:L48
  t.check(detectKeyword("I'm finished"), null);
});

// The matched phrase is replaced with a tag in the processed transcript:
void test("The matched phrase is replaced with a tag in the processed transcript:", async (t) => {
  // doctest:L55
  t.check(detectKeyword("OK send message")?.processedTranscript, "OK <send-message phrase=\"send message\" />");
});

// ## Send and close
//
// "Over and out" sends the message like a plain send, but signals the mic
// should stay closed afterward (the "I'm done, take it from here" sign-off). It
// gets its own action and tag. The older "send and close" family still works:
void test("\"Over and out\" sends the message like a plain send, but signals the mic shoul...", async (t) => {
  // doctest:L66
  t.check(detectKeyword("over and out")?.action, "sendClose");

  // doctest:L69
  t.check(detectKeyword("send and close")?.action, "sendClose");

  // doctest:L72
  t.check(detectKeyword("send and close message")?.action, "sendClose");

  // doctest:L75
  t.check(detectKeyword("send and finished")?.action, "sendClose");

  // doctest:L78
  t.check(detectKeyword("send and stop")?.action, "sendClose");

  // doctest:L81
  t.check(detectKeyword("set a closed message")?.action, "sendClose");

  // doctest:L84
  t.check(detectKeyword("OK send and close")?.processedTranscript, "OK <send-close-message phrase=\"send and close\" />");
});

// Precedence matters: "send and finish the message" satisfies the plain-send
// pattern too (`finish … message`), and "send and stop the mic" / "send and
// close the mic" satisfy the mic-off pattern (`stop the mic`, `close the mic`)
// — but the close variant is checked first and wins all three, so none
// degrades to a plain send or a bare mute:
void test("Precedence matters:", async (t) => {
  // doctest:L95
  t.check(detectKeyword("send and finish the message")?.action, "sendClose");

  // doctest:L98
  t.check(detectKeyword("send and stop the mic")?.action, "sendClose");

  // doctest:L101
  t.check(detectKeyword("send and close the mic")?.action, "sendClose");
});

// ## Send checkpoint
//
// "Send checkpoint" is a plain send on the client (the mic re-arms), with its
// own tag so the agent knows the user is still talking:
void test("\"Send checkpoint\" is a plain send on the client (the mic re-arms), with its o...", async (t) => {
  // doctest:L111
  t.check(detectKeyword("send checkpoint")?.action, "sendCheckpoint");

  // doctest:L114
  t.check(detectKeyword("send a checkpoint")?.action, "sendCheckpoint");

  // doctest:L117
  t.check(detectKeyword("send checkpoint message")?.processedTranscript, "<send-checkpoint-message phrase=\"send checkpoint message\" />");

  // doctest:L120
  t.check(detectKeyword("commit checkpoint")?.action, "sendCheckpoint");

  // doctest:L123
  t.check(detectKeyword("first part of the idea add checkpoint")?.processedTranscript, "first part of the idea <send-checkpoint-message phrase=\"add checkpoint\" />");
});

// Talking about checkpoints does not fire it: the commit/add verbs take no
// article, and "checkpoint" alone is not a command:
void test("Talking about checkpoints does not fire it:", async (t) => {
  // doctest:L131
  t.check(detectKeyword("we should add a checkpoint before the deploy"), null);

  // doctest:L134
  t.check(detectKeyword("the checkpoint failed again"), null);
});

// ## Clean up and send
//
// Both deliberate phrasings request an HQ transcription pass before the normal
// send. They use the ordinary send tag because HQ is client-side preparation,
// not a distinct command for the agent:
void test("Both deliberate phrasings request an HQ transcription pass before the normal...", async (t) => {
  // doctest:L145
  t.check(detectKeyword("clean up and send")?.action, "sendHq");

  // doctest:L148
  t.check(detectKeyword("OK send and clean up")?.action, "sendHq");

  // doctest:L151
  t.check(detectKeyword("OK send and clean up")?.processedTranscript, "OK <send-message phrase=\"send and clean up\" />");
});

// ## Cancel commands
void test("Cancel commands", async (t) => {
  // doctest:L158
  t.check(detectKeyword("cancel message")?.action, "cancel");

  // doctest:L161
  t.check(detectKeyword("abort the message")?.action, "cancel");

  // doctest:L164
  t.check(detectKeyword("nevermind"), null);
});

// "Nevermind" alone doesn't match — it needs "message" or "microphone" after it:
void test("\"Nevermind\" alone doesn't match — it needs \"message\" or \"microphone\" after it:", async (t) => {
  // doctest:L171
  t.check(detectKeyword("nevermind the message")?.action, "cancel");
});

// ## Mic off commands
void test("Mic off commands", async (t) => {
  // doctest:L178
  t.check(detectKeyword("microphone off")?.action, "micOff");

  // doctest:L181
  t.check(detectKeyword("turn off the mic")?.action, "micOff");

  // doctest:L184
  t.check(detectKeyword("stop listening")?.action, "micOff");

  // doctest:L187
  t.check(detectKeyword("close the mic")?.action, "micOff");

  // doctest:L190
  t.check(detectKeyword("mute the microphone")?.action, "micOff");

  // doctest:L193
  t.check(detectKeyword("pause listening")?.action, "micOff");
});

// ## Erase commands
void test("Erase commands", async (t) => {
  // doctest:L200
  t.check(detectKeyword("erase the message")?.action, "erase");

  // doctest:L203
  t.check(detectKeyword("clear my message")?.action, "erase");

  // doctest:L206
  t.check(detectKeyword("start over")?.action, "erase");
});

// ## No match
//
// Regular speech returns null:
void test("Regular speech returns null:", async (t) => {
  // doctest:L215
  t.check(detectKeyword("hello world"), null);

  // doctest:L218
  t.check(detectKeyword("the weather is nice"), null);
});

// ## Re-injecting a send keyword the HQ pass dropped
//
// Every dictated send replaces the realtime transcript with a high-quality pass, and that pass can normalize a trailing trigger phrase away ("…send message" becomes clean prose) or write it in words the spotter does not match. The realtime pass already heard the keyword — that's what fired the send — so when the HQ text comes back without one, the HQ text is kept as it is and the tag is appended with `heard="live"`: the command was detected live, and the end of the text may still hold it in other words:
void test("Every dictated send replaces the realtime transcript with a high-quality pass...", async (t) => {
  // doctest:L227
  t.check(detectKeyword("Buy milk tomorrow."), null);

  // doctest:L230
  t.check(appendSendKeywordTag("Buy milk tomorrow.", { action: "send", matchedPhrase: "send message" }), "Buy milk tomorrow. <send-message phrase=\"send message\" heard=\"live\" />");
});

// The close variant re-injects its own tag, so a dropped "send and close" stays a
// close sign-off in the persisted record:
void test("The close variant re-injects its own tag, so a dropped \"send and close\" stays...", async (t) => {
  // doctest:L238
  t.check(appendSendKeywordTag("Buy milk tomorrow.", { action: "sendClose", matchedPhrase: "send and close" }), "Buy milk tomorrow. <send-close-message phrase=\"send and close\" heard=\"live\" />");
});

// A checkpoint re-injects its tag too, and the tag reads back as the same
// variant, so an HQ pass restored after a reload keeps it:
void test("A checkpoint re-injects its tag too, and the tag reads back as the same varia...", async (t) => {
  // doctest:L246
  const checkpointed = appendSendKeywordTag("Part one.", { action: "sendCheckpoint", matchedPhrase: "send checkpoint" });
  t.check(checkpointed, "Part one. <send-checkpoint-message phrase=\"send checkpoint\" heard=\"live\" />");

  // doctest:L250
  t.check(sendKeywordIn(checkpointed), {
    action: "sendCheckpoint",
    matchedPhrase: "send checkpoint",
  });
});

// Phrases with characters meaningful in XML are escaped, matching the tag form `detectKeyword` itself produces:
void test("Phrases with characters meaningful in XML are escaped, matching the tag form...", async (t) => {
  // doctest:L257
  t.check(appendSendKeywordTag("Ping R&D.", { action: "send", matchedPhrase: 'send "the" message' }), "Ping R&D. <send-message phrase=\"send &quot;the&quot; message\" heard=\"live\" />");
});

// ## A live gap marker breaks a phrase
//
// `[…]` in the live transcript marks words the live pass missed
// (`docs/implemented-plans/live-gap-marker.md`). A command never matches across it: the
// words on either side were not spoken together. A command after it still
// fires, and the marker stays in the text.
void test("[…] in the live transcript marks words the live pass missed (docs/implemented...", async (t) => {
  // doctest:L269
  t.check(detectKeyword("then send […] message"), null);

  // doctest:L272
  t.check(detectKeyword("cancel the […] message"), null);

  // doctest:L275
  t.check(detectKeyword("buy milk […] send message")?.processedTranscript, "buy milk […] <send-message phrase=\"send message\" />");
});
