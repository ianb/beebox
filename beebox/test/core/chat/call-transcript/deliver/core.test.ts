// # Resuming a call fold after a restart
//
// The fold record (`_tmp/calls/<callId>.json`, docs/implemented-plans/chat-calls.md,
// Track G) is the only state a transcribed call leaves on disk. At startup
// `resumeCallFolds` folds every recorded call that is not going on: it reads
// the registered recordings' HQ results and delivers one `<call>` message. The
// record goes only once that message is in the chat's transcript. A call still live in this process is left alone. A
// message typed during the call comes from the record, kept as it was sent,
// since a busy agent writes it to the chat's transcript only later.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTmpBox } from "../../../../helpers/test-helpers.js";
import { createEventBus } from "../../../../../src/core/event-bus/core.js";
import { createStagingSession } from "../../../../../src/core/capture/staging-store/core.js";
import { applyVoiceEvent, sealVoiceSession } from "../../../../../src/core/voice-recording/voice-staging/core.js";
import { listFoldRecords, recordCallChange, recordChatMessage, registerCallRecording } from "../../../../../src/core/chat/call-transcript/record.js";
import { resumeCallFolds } from "../../../../../src/core/chat/call-transcript/deliver/core.js";
import type { CallSnapshot } from "../../../../../src/core/chat/presence/room.js";

const T0 = Date.parse("2026-11-12T19:02:00.000Z");
const priya = { email: "priya@example.com", name: "Priya Marlowe" };
const tomas = { email: "tomas@example.com", name: "Tomas Marlowe" };

function snapshot(boxRoot: string, callId: string): CallSnapshot {
  return {
    boxRoot,
    sessionId: "5d1c9e7a-2b3f-4a6e-8c0d-9e8f7a6b5c4d",
    callId,
    startedAt: T0,
    startedBy: priya,
    members: [{ peerId: "peer-priya", person: priya }, { peerId: "peer-tomas", person: tomas }],
    transcribing: true,
  };
}

/** A recording `createdBy` made whose HQ job finished with word timing. */
async function readyRecording(boxRoot: string, opts: { callId: string; createdBy: string }): Promise<string> {
  const { callId, createdBy } = opts;
  const session = await createStagingSession({ boxRoot, targetSessionId: null, createdBy, kind: "voice" });
  await sealVoiceSession({
    boxRoot, id: session.id, emissionId: null,
    hq: { emissionId: null, sessionId: null, service: "whisper", requestedAt: "2026-11-12T19:05:00.000Z" },
    call: { callId, firstAudioAtMs: T0 + 3_000 },
  });
  await applyVoiceEvent({ boxRoot, id: session.id, event: { type: "pieceStarted", piece: 1, pieces: 1, attempt: 1, pieceSeconds: 300 } });
  await applyVoiceEvent({
    boxRoot, id: session.id,
    event: { type: "allPiecesDone", result: { text: "lemon tart", diarized: false, service: "whisper", pieces: 1, words: [{ start: 1, end: 1.4, text: "lemon" }, { start: 1.5, end: 1.9, text: "tart" }] } },
  });
  return session.id;
}

void test("an ended call left on disk is folded and delivered; until it reaches the chat, the next start delivers it again", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const eventBus = createEventBus(box.root);
  t.teardown(() => eventBus.close());

  const ended = snapshot(box.root, "call-ended-0001");
  await recordCallChange(box.root, { snapshot: ended, change: { kind: "transcribing", by: priya, atMs: T0 + 2_000 }, nowMs: T0 + 2_000 });
  const tomasRecording = await readyRecording(box.root, { callId: ended.callId, createdBy: tomas.email });
  await registerCallRecording(box.root, { snapshot: ended, recording: { voiceSessionId: tomasRecording, person: tomas, clockOffsetMs: 12 }, nowMs: T0 + 2_100 });
  // Priya registers another of Tomas's recordings as hers: it is left out, so his words never appear under her name.
  const warnings: unknown[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args[0]);
  t.teardown(() => {
    console.warn = warn;
  });
  const misregistered = await readyRecording(box.root, { callId: ended.callId, createdBy: tomas.email });
  await registerCallRecording(box.root, { snapshot: ended, recording: { voiceSessionId: misregistered, person: priya, clockOffsetMs: 0 }, nowMs: T0 + 2_200 });
  await recordChatMessage(box.root, { callId: ended.callId, message: { name: "Tomas Marlowe", text: "Pie or crumble?", atMs: T0 + 30_000 } });
  await recordCallChange(box.root, { snapshot: { ...ended, members: [] }, change: { kind: "ended" }, nowMs: T0 + 64_000 });

  // A call still going on in this process keeps its record.
  const live = snapshot(box.root, "call-live-0002");
  await recordCallChange(box.root, { snapshot: live, change: { kind: "transcribing", by: tomas, atMs: T0 + 5_000 }, nowMs: T0 + 5_000 });

  const delivered: { sessionId: string; message: string }[] = [];
  const resumed = await resumeCallFolds(
    { boxRoot: box.root, eventBus, deliver: async (m) => void delivered.push(m) },
    { isLive: (callId) => callId === live.callId },
  );

  t.check({ resumed, delivered, left: (await listFoldRecords(box.root)).map((r) => r.callId) }, {
    resumed: ["call-ended-0001"],
    delivered: [{
      sessionId: "5d1c9e7a-2b3f-4a6e-8c0d-9e8f7a6b5c4d",
      message: `<call people="Priya Marlowe, Tomas Marlowe" duration="1:04" started="2026-11-12T19:02:00.000Z" partial="Priya Marlowe's audio could not be transcribed.">
[0:02] Priya Marlowe turned transcription on
[0:04] Tomas Marlowe: lemon tart
[0:30] Tomas Marlowe (in chat): Pie or crumble?
</call>`,
    }],
    // The fake delivery never reaches the chat's transcript, as when a busy agent's queue is lost in a restart.
    left: ["call-ended-0001", "call-live-0002"],
  });
  t.check(warnings, [`[call-transcript] Recording ${misregistered} is not priya@example.com's recording of call call-ended-0001; left out`]);
  const again = await resumeCallFolds(
    { boxRoot: box.root, eventBus, deliver: async (m) => void delivered.push(m) },
    { isLive: (callId) => callId === live.callId },
  );
  t.check({ again, deliveries: delivered.length }, { again: ["call-ended-0001"], deliveries: 2 });
});
