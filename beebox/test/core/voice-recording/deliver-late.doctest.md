# Late delivery of the HQ correction

`buildCorrectionWrapper` builds the `<speech corrects="…">` wire text;
`attemptLateDelivery` (`docs/plans/resilient-voice-recording.md`, Track 1)
advances one recording's `late`/`delivering` handoff by one step, using the
landed probe to decide whether to move forward — never sending a correction
for a message that never arrived, and never re-sending one that already
landed. A hand-written fake session/registry stands in for the chat runtime
(mirroring `prepare.doctest.md`'s "double-delivery resume" test): its `send`
appends a real line to the transcript file the landed probe reads, so the
probe's behavior is exercised for real rather than mocked away.

```ts setup
import { mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { createEventBus } from "../../../src/core/event-bus.js";
import { appendHistory, resolveSessionLogPath } from "../../../src/core/chat/session/history.js";
import {
  createStagingSession,
  readStagingSession,
  writeStagingSession,
} from "../../../src/core/capture/staging-store.js";
import { sealVoiceSession, applyVoiceEvent } from "../../../src/core/voice-recording/voice-staging.js";
import { attemptLateDelivery, buildCorrectionWrapper } from "../../../src/core/voice-recording/deliver-late.js";

const RESULT = { text: "hq transcript text", diarized: false, service: "whisper", pieces: 1 };

// Drives a fresh voice session straight to `hq: ready, handoff: late` — the
// order matters: `fallBackRequested` must land BEFORE `allPiecesDone` or the
// state machine sends the handoff to `claimed` instead (HQ already won).
async function stageLateRecording(box, { targetSessionId, emissionId, result }) {
  const session = await createStagingSession({ boxRoot: box.root, targetSessionId, createdBy: null, kind: "voice" });
  await sealVoiceSession({
    boxRoot: box.root, id: session.id,
    hq: { emissionId, sessionId: targetSessionId, service: "whisper", requestedAt: "2026-09-10T18:00:00.000Z" },
  });
  await applyVoiceEvent({ boxRoot: box.root, id: session.id, event: { type: "fallBackRequested", emissionId, sessionId: targetSessionId } });
  await applyVoiceEvent({ boxRoot: box.root, id: session.id, event: { type: "allPiecesDone", result: result ?? RESULT } });
  return session;
}

// Seeds an (initially empty) transcript at the path `resolveSessionLogPath`
// resolves for `sessionId`, once `sessionId` is known to box history.
async function seedTranscript(box, sessionId) {
  await appendHistory(box.root, { sessionId });
  const logPath = await resolveSessionLogPath(box.root, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, "");
  return logPath;
}

function userTurn({ uuid, text }) {
  return JSON.stringify({
    type: "user",
    uuid,
    timestamp: "2026-09-10T18:00:00.000Z",
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

// A fake registry with one live session bound to `sessionId`. `send` appends
// a real line to `logPath` (so the landed probe finds it) and records what it
// was asked to send; `busy.value` controls what `isBusy()` reports.
function makeFakeRegistry({ sessionId, logPath, busy }) {
  const sent = [];
  const session = {
    isBusy: () => busy.value,
    enqueue: (message) => sent.push(message.text ?? message),
    getSessionId: () => sessionId,
    send: async (input) => {
      sent.push(input.text);
      await appendFile(logPath, userTurn({ uuid: `c${String(sent.length)}`, text: input.text }) + "\n");
      return true;
    },
  };
  const registry = {
    getOrCreate: () => session,
    createNew: () => session,
    get: () => session,
    enforceLiveCap: () => {},
    touch: () => {},
    markMostActive: async () => {},
    // No chat here was coined and reserved (chat/session/reserve.ts).
    getReservation: () => null,
  };
  return { registry, sent };
}
```

## `buildCorrectionWrapper`: attribute order, diarization, attribution escaping

```ts
buildCorrectionWrapper({ recordingId: "rec-1", emissionId: "em-1", service: "mai-diarized", diarized: true, text: "1A: hello" })
=> <speech stt="hq" stt-service="mai-diarized" diarized="1" message-id="rec-1" corrects="em-1">1A: hello</speech>

buildCorrectionWrapper({ recordingId: "rec-2", emissionId: "em-2", service: "whisper", diarized: false, text: "hi there", user: { name: "Noor Haddad", email: "noor@example.com" } })
=> <speech stt="hq" stt-service="whisper" message-id="rec-2" corrects="em-2" user="Noor Haddad" user-email="noor@example.com">hi there</speech>

buildCorrectionWrapper({ recordingId: "rec-3", emissionId: "em-3", service: "whisper", diarized: false, text: "hi", user: { name: "Weird \"Name\"", email: "w@example.com" } })
=> <speech stt="hq" stt-service="whisper" message-id="rec-3" corrects="em-3" user="Weird &quot;Name&quot;" user-email="w@example.com">hi</speech>
```

## The original never landed: stays `late`, nothing is sent

```ts
const box = await makeTmpBox();
const eventBus = createEventBus(box.root);
const logPath = await seedTranscript(box, "chat-1"); // empty — the realtime send never arrived
const busy = { value: false };
const { registry, sent } = makeFakeRegistry({ sessionId: "chat-1", logPath, busy });

const session = await stageLateRecording(box, { targetSessionId: "chat-1", emissionId: "em-1" });
await attemptLateDelivery({ boxRoot: box.root, id: session.id, eventBus, registry });

const after = await readStagingSession({ boxRoot: box.root, id: session.id });
JSON.stringify(after.voice.handoff)
=> {"mode":"late","emissionId":"em-1"}

sent.length
=> 0
```

```ts cleanup
eventBus.close();
await rm(dirname(logPath), { recursive: true, force: true });
await box.cleanup();
```

## The original landed: exactly one correction, carrying its attribution

```ts
const box = await makeTmpBox();
const eventBus = createEventBus(box.root);
const logPath = await seedTranscript(box, "chat-1");
await appendFile(
  logPath,
  userTurn({
    uuid: "original",
    text: '<speech user="Noor Haddad" user-email="noor@example.com" stt="deepgram" message-id="em-1">original text</speech>',
  }) + "\n",
);
const busy = { value: false };
const { registry, sent } = makeFakeRegistry({ sessionId: "chat-1", logPath, busy });

const session = await stageLateRecording(box, { targetSessionId: "chat-1", emissionId: "em-1" });
await attemptLateDelivery({ boxRoot: box.root, id: session.id, eventBus, registry });

const after = await readStagingSession({ boxRoot: box.root, id: session.id });
JSON.stringify(after.voice.handoff)
=> {"mode":"delivered","emissionId":"em-1","messageId":"«*»"}
```

Exactly one correction was sent, and it carries the original's `user`/`user-email`
attribution plus the HQ result text:

```ts continue
sent.length
=> 1

sent[0].includes('corrects="em-1"')
=> true

sent[0].includes('user="Noor Haddad" user-email="noor@example.com"')
=> true

sent[0].includes(RESULT.text)
=> true
```

```ts cleanup
eventBus.close();
await rm(dirname(logPath), { recursive: true, force: true });
await box.cleanup();
```

## A busy target session defers the send; it lands once the turn frees up

```ts
const box = await makeTmpBox();
const eventBus = createEventBus(box.root);
const logPath = await seedTranscript(box, "chat-1");
await appendFile(logPath, userTurn({ uuid: "original", text: '<speech stt="deepgram" message-id="em-1">original text</speech>' }) + "\n");
const busy = { value: true }; // an agent turn is in flight
const { registry, sent } = makeFakeRegistry({ sessionId: "chat-1", logPath, busy });

const session = await stageLateRecording(box, { targetSessionId: "chat-1", emissionId: "em-1" });
await attemptLateDelivery({ boxRoot: box.root, id: session.id, eventBus, registry });

const afterFirstTick = await readStagingSession({ boxRoot: box.root, id: session.id });
JSON.stringify(afterFirstTick.voice.handoff)
=> {"mode":"delivering","emissionId":"em-1"}

// The original landed, moving late → delivering, but no correction was
// attempted while the target session read busy.
sent.length
=> 0
```

The turn ends; the next sweep tick finds the session idle and delivers:

```ts continue
busy.value = false;
await attemptLateDelivery({ boxRoot: box.root, id: session.id, eventBus, registry });

const afterSecondTick = await readStagingSession({ boxRoot: box.root, id: session.id });
afterSecondTick.voice.handoff.mode
=> delivered

sent.length
=> 1
```

```ts cleanup
eventBus.close();
await rm(dirname(logPath), { recursive: true, force: true });
await box.cleanup();
```

## A crash between send and confirm: resume re-probes and does not double-send

```ts
const box = await makeTmpBox();
const eventBus = createEventBus(box.root);
const logPath = await seedTranscript(box, "chat-1");
await appendFile(logPath, userTurn({ uuid: "original", text: '<speech stt="deepgram" message-id="em-1">original text</speech>' }) + "\n");
const busy = { value: false };
const { registry, sent } = makeFakeRegistry({ sessionId: "chat-1", logPath, busy });

const session = await stageLateRecording(box, { targetSessionId: "chat-1", emissionId: "em-1" });
await attemptLateDelivery({ boxRoot: box.root, id: session.id, eventBus, registry });

const delivered = await readStagingSession({ boxRoot: box.root, id: session.id });
delivered.voice.handoff.mode
=> delivered
```

Simulate a crash right before `landedConfirmed` persisted — the correction
really did land (the send above already appended it to the transcript), but
the manifest is rolled back to `delivering` by hand, as a crash mid-write
would leave it:

```ts continue
const crashed = await readStagingSession({ boxRoot: box.root, id: session.id });
crashed.voice.handoff = { mode: "delivering", emissionId: "em-1" };
await writeStagingSession({ boxRoot: box.root, session: crashed });

await attemptLateDelivery({ boxRoot: box.root, id: session.id, eventBus, registry });

const afterResume = await readStagingSession({ boxRoot: box.root, id: session.id });
afterResume.voice.handoff.mode
=> delivered
```

No second send happened — the landed probe found the correction already in
the transcript and confirmed it, rather than sending a duplicate:

```ts continue
sent.length
=> 1
```

```ts cleanup
eventBus.close();
await rm(dirname(logPath), { recursive: true, force: true });
await box.cleanup();
```

## A terminally failed HQ result never delivers, even while `late`

```ts
const box = await makeTmpBox();
const eventBus = createEventBus(box.root);
const logPath = await seedTranscript(box, "chat-1");
await appendFile(logPath, userTurn({ uuid: "original", text: '<speech stt="deepgram" message-id="em-1">original text</speech>' }) + "\n");
const busy = { value: false };
const { registry, sent } = makeFakeRegistry({ sessionId: "chat-1", logPath, busy });

const session = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null, kind: "voice" });
await sealVoiceSession({
  boxRoot: box.root, id: session.id,
  hq: { emissionId: "em-1", sessionId: "chat-1", service: "whisper", requestedAt: "2026-09-10T18:00:00.000Z" },
});
await applyVoiceEvent({ boxRoot: box.root, id: session.id, event: { type: "fallBackRequested", emissionId: "em-1", sessionId: "chat-1" } });
await applyVoiceEvent({
  boxRoot: box.root, id: session.id,
  event: {
    type: "pieceFailed", classification: "permanent", pieceSeconds: 300, attempt: 1,
    nextAttemptAt: "2026-09-10T18:00:00.000Z",
    failure: { code: "http_401", message: "no api key" },
  },
});

await attemptLateDelivery({ boxRoot: box.root, id: session.id, eventBus, registry });

const after = await readStagingSession({ boxRoot: box.root, id: session.id });
JSON.stringify({ hq: after.voice.hq.state, handoff: after.voice.handoff })
=> {"hq":"failed","handoff":{"mode":"late","emissionId":"em-1"}}

sent.length
=> 0
```

```ts cleanup
eventBus.close();
await rm(dirname(logPath), { recursive: true, force: true });
await box.cleanup();
```
