// # Composer input machine
//
// `composerMachine` is the coordination overlay for the chat composer's speech ↔
// mic interplay: the `voice` region (`idle | speaking | pausedForSpeech`), the
// narration `hq` region, and the mobile `keyboard` region. Whether the mic is
// recording lives in the transcription machine and is mirrored in as the
// `recording` flag. The machine commands the real mic/TTS devices through named
// action seams; here we replace those seams with spies and assert the
// *decisions*. See `docs/chat/composer.md`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createActor } from "xstate";
import { composerMachine, type ComposerEvent } from "../../src/machines/composerMachine.js";

// Build a started actor that records the device commands it emits into `calls`.
function mk(input?: { narration?: boolean; muted?: boolean }) {
  const calls: string[] = [];
  const actor = createActor(composerMachine, { input: input ?? {} });
  actor.on("command", ({ command }) => { calls.push(command.type); });
  actor.start();
  return { actor, calls };
}

const queued: ComposerEvent = { type: "SPEECH_QUEUED", messageId: "m1", segments: [], baseIndex: 0 };

// ## Starting dictation
//
// `START_DICTATION` marks a turn active and commands the mic. The voice overlay
// stays `idle` — "recording" is the transcription machine's state, not ours.
void test("STARTDICTATION marks a turn active and commands the mic.", async (t) => {
  const { actor, calls } = mk();
  actor.send({ type: "START_DICTATION" });
  const s = actor.getSnapshot();
  t.check({ value: s.value, turnTaking: s.context.turnTaking, calls }, {
    value: { voice: "idle", hq: "idle", keyboard: "closed" },
    turnTaking: true,
    calls: ["startMic"],
  });
});

// ## Speech while recording holds the mic (playback → recording)
//
// With the mic recording (empty transcript), a queued segment holds the mic
// and plays — landing in `pausedForSpeech`, which remembers to resume.
void test("With the mic recording (empty transcript), a queued segment holds the mic and plays.", async (t) => {
  const { actor, calls } = mk();
  actor.send({ type: "RECORDING", value: true });
  actor.send(queued);
  t.check(actor.getSnapshot().value, { voice: "pausedForSpeech", hq: "idle", keyboard: "closed" });

  t.check(calls.join(","), "holdMic,playSpeech");

  // When playback finishes, the mic auto-resumes (the whole point of `voicePaused`):

  actor.send({ type: "SPEECH_DONE" });
  t.check(actor.getSnapshot().value, { voice: "idle", hq: "idle", keyboard: "closed" });

  t.check(calls.join(","), "holdMic,playSpeech,resumeMic");
});

// ## Stopping speech from the paused state resumes the mic
//
// `STOP_SPEECH` (e.g. the SpeechMenu Stop) while paused hands recording back —
// the fix that used to be a hand-written `if (voicePausedRef.current)` branch.
void test("STOPSPEECH (e.g.", async (t) => {
  const { actor, calls } = mk();
  actor.send({ type: "RECORDING", value: true });
  actor.send(queued);
  actor.send({ type: "STOP_SPEECH" });
  t.check(actor.getSnapshot().value, { voice: "idle", hq: "idle", keyboard: "closed" });

  t.check(calls.join(","), "holdMic,playSpeech,stopSpeech,resumeMic");
});

// `RESUME` (tapping the pulsing mic) does the same:
void test("RESUME (tapping the pulsing mic) does the same:", async (t) => {
  const { actor, calls } = mk();
  actor.send({ type: "RECORDING", value: true });
  actor.send(queued);
  actor.send({ type: "RESUME" });
  t.check(actor.getSnapshot().value, { voice: "idle", hq: "idle", keyboard: "closed" });

  t.check(calls.join(","), "holdMic,playSpeech,stopSpeech,resumeMic");
});

// ## Talking suppresses the agent's voice (recording → speech output)
//
// If the transcript already has text when speech is queued, it is marked played
// but never spoken — the user isn't talked over.
void test("If the transcript already has text when speech is queued, it is marked played...", async (t) => {
  const { actor, calls } = mk();
  actor.send({ type: "RECORDING", value: true });
  actor.send({ type: "TRANSCRIPT", nonEmpty: true });
  actor.send(queued);
  t.check(actor.getSnapshot().value, { voice: "idle", hq: "idle", keyboard: "closed" });

  t.check(calls.join(","), "markPlayed");
});

// ## Muted speech never plays
void test("Muted speech never plays", async (t) => {
  const { actor, calls } = mk();
  actor.send({ type: "SET_MUTE", value: true });
  actor.send(queued);
  t.check(actor.getSnapshot().value, { voice: "idle", hq: "idle", keyboard: "closed" });

  t.check(calls.join(","), "markPlayed");
});

// ## Speech with the mic idle plays, then returns to idle
void test("Speech with the mic idle plays, then returns to idle", async (t) => {
  const { actor, calls } = mk();
  actor.send(queued);
  t.check(actor.getSnapshot().value, { voice: "speaking", hq: "idle", keyboard: "closed" });

  t.check(calls.join(","), "playSpeech");

  actor.send({ type: "SPEECH_DONE" });
  t.check(actor.getSnapshot().value, { voice: "idle", hq: "idle", keyboard: "closed" });
});

// ## Speech during an active turn reopens the mic on completion
//
// `turnTaking` (set by START_DICTATION) makes a completed `speaking` reopen the
// mic — the non-paused auto-restart.
void test("turnTaking (set by STARTDICTATION) makes a completed speaking reopen the mic...", async (t) => {
  const { actor, calls } = mk();
  actor.send({ type: "START_DICTATION" });
  actor.send(queued);
  t.check(actor.getSnapshot().value, { voice: "speaking", hq: "idle", keyboard: "closed" });

  actor.send({ type: "SPEECH_DONE" });
  t.check(actor.getSnapshot().value, { voice: "idle", hq: "idle", keyboard: "closed" });

  t.check(calls.join(","), "startMic,playSpeech,startMic");
});

// ## Manually starting the mic while speaking stops the speech
//
// Closes the latent "recording while speech still playing" edge: a fresh
// START_DICTATION stops playback first.
void test("Closes the latent \"recording while speech still playing\" edge:", async (t) => {
  const { actor, calls } = mk();
  actor.send(queued);
  actor.send({ type: "START_DICTATION" });
  t.check(actor.getSnapshot().value, { voice: "idle", hq: "idle", keyboard: "closed" });

  t.check(calls.join(","), "playSpeech,stopSpeech,startMic");
});

// ## Native barge-in stops the speech without opening the web mic
//
// The iOS record button opens the *native* microphone itself and asks this page
// only to stop talking (mobile-contract §4.9). That command lands as `STOP_SPEECH`
// rather than `START_DICTATION`: the page is the speaker but not the listener, so
// it must not `startMic`, and `turnTaking` must stay false or the next
// `SPEECH_DONE` would reopen a microphone nobody is watching.
void test("The iOS record button opens the native microphone itself and asks this page o...", async (t) => {
  const { actor, calls } = mk();
  actor.send(queued);
  actor.send({ type: "STOP_SPEECH" });
  const s = actor.getSnapshot();
  t.check({ value: s.value, turnTaking: s.context.turnTaking, calls }, {
    value: { voice: "idle", hq: "idle", keyboard: "closed" },
    turnTaking: false,
    calls: ["playSpeech", "stopSpeech"],
  });
});

// ## Manual stop ends the turn
//
// A user-driven `STOP_DICTATION` ends turn-taking (so the agent won't auto-reopen
// the mic after its next reply). Mic teardown is the handler's job, not the
// machine's.
void test("A user-driven STOPDICTATION ends turn-taking (so the agent won't auto-reopen...", async (t) => {
  const { actor, calls } = mk();
  actor.send({ type: "START_DICTATION" });
  actor.send({ type: "STOP_DICTATION" });
  const s = actor.getSnapshot();
  t.check(s.context.turnTaking, false);

  t.check(calls.join(","), "startMic");
});

// ## Manual replay holds the mic without re-playing
//
// `SPEECH_EXTERNAL` (the SpeechMenu Replay, which plays on its own) holds an
// active recording — `pausedForSpeech` with no `playSpeech` call. Holding keeps
// the segment, its text, and its recording; a cancel here once discarded what
// the person had said (issues/closed/bugs/2026-10-20-replaying-agent-audio-drops-the-recording.md).
void test("SPEECHEXTERNAL (the SpeechMenu Replay, which plays on its own) holds an active recording.", async (t) => {
  const { actor, calls } = mk();
  actor.send({ type: "RECORDING", value: true });
  actor.send({ type: "SPEECH_EXTERNAL" });
  t.check(actor.getSnapshot().value, { voice: "pausedForSpeech", hq: "idle", keyboard: "closed" });

  t.check(calls.join(","), "holdMic");
});

// The replay is allowed with words already on screen (unlike queued speech,
// which never talks over them); it holds the mic and releases it when it ends:
void test("A replay over a non-empty transcript holds the mic, then releases it.", async (t) => {
  const { actor, calls } = mk();
  actor.send({ type: "RECORDING", value: true });
  actor.send({ type: "TRANSCRIPT", nonEmpty: true });
  actor.send({ type: "SPEECH_EXTERNAL" });
  t.check(actor.getSnapshot().value, { voice: "pausedForSpeech", hq: "idle", keyboard: "closed" });

  actor.send({ type: "SPEECH_DONE" });
  t.check(calls.join(","), "holdMic,resumeMic");
});

// From an idle mic it just reflects that speech is playing:
void test("From an idle mic it just reflects that speech is playing:", async (t) => {
  const { actor, calls } = mk();
  actor.send({ type: "SPEECH_EXTERNAL" });
  t.check(actor.getSnapshot().value, { voice: "speaking", hq: "idle", keyboard: "closed" });

  t.check(calls, []);
});

// ## Voice sends waiting for HQ
//
// Each voice send that waits for its HQ transcript is a pending bubble
// (`docs/plans/resilient-voice-recording.md`, Track 4). `START_HQ` adds one and
// lights the in-flight region; several can wait at once. `HQ_STATUS` updates
// one bubble's status line.
void test("Each voice send that waits for its HQ transcript is a pending bubble (docs/pl...", async (t) => {
  const { actor, calls } = mk();
  actor.send({ type: "START_HQ", id: "m1", text: "first draft" });
  actor.send({ type: "START_HQ", id: "m2", text: "second draft" });
  actor.send({ type: "HQ_STATUS", id: "m1", status: "Transcribing part 2 of 3" });
  const s = actor.getSnapshot();
  t.check(s.value, { voice: "idle", hq: "inFlight", keyboard: "closed" });

  t.check(s.context.pendingHq, [
    {
      id: "m1",
      text: "first draft",
      status: "Transcribing part 2 of 3",
    },
    {
      id: "m2",
      text: "second draft",
      status: "Uploading audio…",
    },
  ]);

  // `HQ_SEND_LIVE` is the bubble's "Send live text now" control: it marks the
  // bubble and emits the command the wiring routes to that send's HQ wait.

  actor.send({ type: "HQ_SEND_LIVE", id: "m2" });
  t.check({ calls, status: actor.getSnapshot().context.pendingHq[1]?.status }, {
    calls: [
      "sendHqLive",
    ],
    status: "Sending live text…",
  });

  // `HQ_DONE` removes one bubble; the region goes idle only with the last.

  actor.send({ type: "HQ_DONE", id: "m1" });
  const s2 = actor.getSnapshot();
  t.check({ value: s2.value, ids: s2.context.pendingHq.map((p) => p.id) }, {
    value: { voice: "idle", hq: "inFlight", keyboard: "closed" },
    ids: [
      "m2",
    ],
  });

  actor.send({ type: "HQ_DONE", id: "m2" });
  t.check(actor.getSnapshot().value, { voice: "idle", hq: "idle", keyboard: "closed" });
});

// ## Mobile keyboard region
//
// Opens, locks, and auto-closes on send only when unlocked.
void test("Opens, locks, and auto-closes on send only when unlocked.", async (t) => {
  const { actor } = mk();
  actor.send({ type: "OPEN_KEYBOARD" });
  t.check(actor.getSnapshot().value, { voice: "idle", hq: "idle", keyboard: { open: "unlocked" } });

  // An unlocked keyboard closes when a message is sent:

  actor.send({ type: "MESSAGE_SENT" });
  t.check(actor.getSnapshot().value, { voice: "idle", hq: "idle", keyboard: "closed" });
});

// A locked keyboard stays open across a send:
void test("A locked keyboard stays open across a send:", async (t) => {
  const { actor } = mk();
  actor.send({ type: "OPEN_KEYBOARD" });
  actor.send({ type: "TOGGLE_LOCK" });
  actor.send({ type: "MESSAGE_SENT" });
  t.check(actor.getSnapshot().value, { voice: "idle", hq: "idle", keyboard: { open: "locked" } });
});

// ## A send always ends the turn (region runs alongside the keyboard)
//
// `MESSAGE_SENT` resets `turnTaking` via the voice region even as the keyboard
// region closes — confirming the parallel regions both process the event.
void test("MESSAGESENT resets turnTaking via the voice region even as the keyboard regio...", async (t) => {
  const { actor } = mk();
  actor.send({ type: "START_DICTATION" });
  actor.send({ type: "OPEN_KEYBOARD" });
  actor.send({ type: "MESSAGE_SENT" });
  const s = actor.getSnapshot();
  t.check({ value: s.value, turnTaking: s.context.turnTaking }, {
    value: { voice: "idle", hq: "idle", keyboard: "closed" },
    turnTaking: false,
  });
});
