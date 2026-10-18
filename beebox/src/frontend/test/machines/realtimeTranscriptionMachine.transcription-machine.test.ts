// # The transcription machine's reducers, driven as a machine
//
// Until 2026-09-12 nothing could import `realtimeTranscriptionMachine` under
// Node: it transitively pulled `machines/transcription-mic.ts`, whose static
// `import … from "…?url"` is a Vite-only asset reference the tap/tsx loader
// cannot resolve, so the module failed to load and the machine, its actor and
// `useRealtimeTranscription` were all untestable
// (`issues/code-quality/2026-08-15-transcription-machine-untestable-worklet-import.md`).
// That import is now deferred to mic start, so a doctest that never opens a
// microphone never resolves it — and the reducers below are exercised as
// transitions rather than as pure functions called by hand.
//
// The real actor is replaced: these assertions are about the machine's own
// bookkeeping, not about a socket.

import { test } from "tap";
import "agent-doctest/tap";
import { createActor } from "xstate";
import { fromCallback } from "xstate";
import type { TranscriptionActorCommand, TranscriptionActorInput, TranscriptionEvent } from "../../src/machines/transcription-events.js";
import { realtimeTranscriptionMachine, transcriptionStateOf } from "../../src/machines/realtimeTranscriptionMachine.js";

/** A finished segment's sealing obligation; the examples here never read it. */
const NO_AUDIO = { recordingId: "rec-none", seal: () => {}, discard: () => {} };

/** A transcriber that connects and then does nothing until told. */
const inertTranscriber = fromCallback<TranscriptionActorCommand, TranscriptionActorInput, TranscriptionEvent>(() => () => {});

/**
 * START lands in `active.connecting`, where only mic permission and worklet
 * startup happen and TEXT_UPDATE is not handled at all. The real actor sends
 * `MIC_LIVE` once the microphone is up (→ `recordingLocal`, audio staging with
 * no live text) and `WS_CONNECTED` once the socket is too (→ `recording`).
 * These tests walk that same path rather than reaching into the machine.
 */
// Every actor started here is stopped at the end: the machine arms `after`
// timers (silence, max duration, connect), and a live timer keeps the test
// process alive past its assertions.
const running: Array<{ stop: () => void }> = [];

function started(targetSessionId?: string | null) {
  const actor = createActor(
    realtimeTranscriptionMachine.provide({ actors: { transcriptionActor: inertTranscriber } }),
  );
  actor.start();
  actor.send({ type: "START", targetSessionId: targetSessionId === undefined ? "s1" : targetSessionId });
  actor.send({ type: "MIC_LIVE" });
  actor.send({ type: "WS_CONNECTED" });
  running.push(actor);
  return actor;
}

// `START` opens a fresh segment: whatever the previous one left behind is gone,
// and the target session is recorded for the actor to read.
void test("START opens a fresh segment:", async (t) => {
  t.teardown(async () => {
    try {
      for (const actor of running) actor.stop();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L57
  const actor = started("session-abc");
  t.check(
    {
      state: transcriptionStateOf(actor.getSnapshot()),
      finalTranscript: actor.getSnapshot().context.finalTranscript,
      interimTranscript: actor.getSnapshot().context.interimTranscript,
      finalWords: actor.getSnapshot().context.finalWords,
      error: actor.getSnapshot().context.error,
      targetSessionId: actor.getSnapshot().context.targetSessionId,
    },
    {
    state: "recording",
    finalTranscript: "",
    interimTranscript: "",
    finalWords: null,
    error: null,
    targetSessionId: "session-abc",
  },
  );

  // `TEXT_UPDATE` replaces the whole segment rather than appending. The actor owns
  // accumulation — the machine holds what it was last told — so a later update with
  // a shorter final text is not a regression to guard against here.

  // doctest:L74
  actor.send({ type: "TEXT_UPDATE", finalText: "hello", interimText: "wor", finalWords: null });
  const first = { ...actor.getSnapshot().context };
  actor.send({ type: "TEXT_UPDATE", finalText: "hello world", interimText: "", finalWords: [] });
  t.check(
    {
      firstFinal: first.finalTranscript,
      firstInterim: first.interimTranscript,
      thenFinal: actor.getSnapshot().context.finalTranscript,
      thenInterim: actor.getSnapshot().context.interimTranscript,
      wordsNullToEmpty: [first.finalWords, actor.getSnapshot().context.finalWords],
    },
    {
    firstFinal: "hello",
    firstInterim: "wor",
    thenFinal: "hello world",
    thenInterim: "",
    wordsNullToEmpty: [
      null,
      [],
    ],
  },
  );

  // `null` and `[]` finalWords are DIFFERENT: `null` means no confidence data was
  // captured for this segment (Voxtral/OpenAI realtime, or nothing finalized yet),
  // `[]` means a backend that reports words captured none. The machine must carry
  // that distinction rather than normalizing it (`wordsNullToEmpty` above).
  //
  // A `TRANSCRIPTION_DONE` that carries text wins and clears the interim; one with
  // empty text keeps what was already final. This is the reconnect-shaped case —
  // the transcript must not be blanked by a finalization that brought nothing.

  // doctest:L97
  const keeper = started();
  keeper.send({ type: "TEXT_UPDATE", finalText: "kept text", interimText: "pending", finalWords: null });
  keeper.send({ type: "TRANSCRIPTION_DONE", text: "", recording: NO_AUDIO });
  const afterEmpty = { ...keeper.getSnapshot().context };

  // doctest:L102
  const replacer = started();
  replacer.send({ type: "TEXT_UPDATE", finalText: "old", interimText: "pending", finalWords: null });
  replacer.send({ type: "TRANSCRIPTION_DONE", text: "final text", words: [], recording: NO_AUDIO });
  t.check(
    {
      emptyKeptFinal: afterEmpty.finalTranscript,
      emptyClearedInterim: afterEmpty.interimTranscript,
      replaced: replacer.getSnapshot().context.finalTranscript,
      replacedInterim: replacer.getSnapshot().context.interimTranscript,
    },
    {
    emptyKeptFinal: "kept text",
    emptyClearedInterim: "",
    replaced: "final text",
    replacedInterim: "",
  },
  );
});
