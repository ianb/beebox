# Voice recording GC sweep

`sweepVoiceSessions` (`docs/plans/resilient-voice-recording.md`, Track 1)
deletes a voice session's staging directory 7 days after creation if it was
never sealed, or 7 days after it reaches a terminal handoff/HQ state. A
session mid-late-delivery (`late`/`delivering`) is never terminal here — it's
collected in `lateDeliveryPending` instead, a hook for a later chunk.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { createStagingSession, readStagingSession, writeStagingSession } from "../../../src/core/capture/staging-store.js";
import { sealVoiceSession, applyVoiceEvent } from "../../../src/core/voice-recording/voice-staging.js";
import { sweepVoiceSessions } from "../../../src/core/voice-recording/sweep.js";

async function configureBox(box) {
  await box.write(".gitignore", ["_tmp/", ".beebox/"].join("\n") + "\n");
  box.commitAll("configure");
}

// Directly backdate a timestamp field on the manifest, bypassing getBoxTimeISO
// — the sweep's retention math is a plain wall-clock diff against whatever's
// on disk, so this is the simplest way to make a session "old" in a test.
async function backdate(box, id, patch) {
  const session = await readStagingSession({ boxRoot: box.root, id });
  Object.assign(session, patch.session || {});
  Object.assign(session.voice, patch.voice || {});
  await writeStagingSession({ boxRoot: box.root, session });
}

const EIGHT_DAYS_AGO = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
const SIX_DAYS_AGO = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
```

## An open, never-sealed recording is GC'd after 7 days — not before

```ts
const box = await makeTmpBox({ git: true });
await configureBox(box);

const stale = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null, kind: "voice" });
await backdate(box, stale.id, { session: { createdAt: EIGHT_DAYS_AGO } });

const fresh = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null, kind: "voice" });
await backdate(box, fresh.id, { session: { createdAt: SIX_DAYS_AGO } });

const result = await sweepVoiceSessions({ boxRoot: box.root });
JSON.stringify(result.deleted)
=> ["«*»"]
```

```ts continue
JSON.stringify({
  deletedWasStale: result.deleted[0] === stale.id,
  staleGone: (await readStagingSession({ boxRoot: box.root, id: stale.id })) === null,
  freshStillThere: (await readStagingSession({ boxRoot: box.root, id: fresh.id })) !== null,
})
=> {"deletedWasStale":true,"staleGone":true,"freshStillThere":true}
```

```ts cleanup
await box.cleanup();
```

## A sealed recording with no HQ requested is terminal immediately, GC'd 7 days later

```ts
const box = await makeTmpBox({ git: true });
await configureBox(box);

const session = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null, kind: "voice" });
await sealVoiceSession({ boxRoot: box.root, id: session.id, hq: null });

const sealed = await readStagingSession({ boxRoot: box.root, id: session.id });
JSON.stringify({ sealedAt: sealed.voice.sealedAt === sealed.voice.terminalAt, terminalAtSet: sealed.voice.terminalAt !== undefined })
=> {"sealedAt":true,"terminalAtSet":true}
```

```ts continue
await backdate(box, session.id, { voice: { terminalAt: EIGHT_DAYS_AGO } });
const result = await sweepVoiceSessions({ boxRoot: box.root });
JSON.stringify({
  deletedThisOne: result.deleted[0] === session.id && result.deleted.length === 1,
  gone: (await readStagingSession({ boxRoot: box.root, id: session.id })) === null,
})
=> {"deletedThisOne":true,"gone":true}
```

```ts cleanup
await box.cleanup();
```

## A `late` handoff is never GC'd by the terminal path — it's flagged for re-probe instead

```ts
const box = await makeTmpBox({ git: true });
await configureBox(box);

const session = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null, kind: "voice" });
await sealVoiceSession({
  boxRoot: box.root, id: session.id,
  hq: { emissionId: "e1", sessionId: "chat-1", service: "whisper", requestedAt: "2026-09-10T18:00:00.000Z" },
});
// Fall back BEFORE the HQ result is ready, so the handoff lands on `late`
// (not `claimed` — that only happens when `fallBackRequested` finds an
// already-`ready` result, per `nextVoiceState`'s claim/fallback race).
await applyVoiceEvent({ boxRoot: box.root, id: session.id, event: { type: "fallBackRequested", emissionId: "e1" } });
await applyVoiceEvent({
  boxRoot: box.root, id: session.id,
  event: { type: "allPiecesDone", result: { text: "hi", diarized: false, service: "whisper", pieces: 1 } },
});
await backdate(box, session.id, { session: { lastActivityAt: EIGHT_DAYS_AGO } });

const result = await sweepVoiceSessions({ boxRoot: box.root });
JSON.stringify({
  deleted: result.deleted,
  flaggedThisOne: result.lateDeliveryPending[0] === session.id && result.lateDeliveryPending.length === 1,
})
=> {"deleted":[],"flaggedThisOne":true}
```

```ts continue
const stillThere = await readStagingSession({ boxRoot: box.root, id: session.id });
stillThere !== null
=> true
```

```ts cleanup
await box.cleanup();
```
