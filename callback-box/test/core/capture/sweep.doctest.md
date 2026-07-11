# Capture abandonment sweep

`sweepAbandonedCaptures` turns staged captures the browser never finished into
delivered-but-partial captures, discards empty orphans, and logs (never retries
or deletes) stale failures and unfiled `tmp-capture/` cards. "Old" is measured
against `CB_TIME`: sessions are created at one frozen time, then the clock is
advanced past the 60-minute window before the sweep runs.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { splitCardContent } from "../../../src/cards/index.js";
import { createEventBus } from "../../../src/core/event-bus.js";
import { ChatSessionRegistry } from "../../../src/core/chat/session/registry.js";
import { createFakeChatBackend } from "../../../src/services/claude-chat.js";
import { plainTestPrompt, tick } from "../../helpers/chat-session-spawner-helpers.js";
import {
  createStagingSession,
  addAudioChunk,
  addPhoto,
  setStagingState,
  readStagingSession,
} from "../../../src/core/capture/staging-store.js";
import { sweepAbandonedCaptures } from "../../../src/core/capture/sweep.js";
import { prepareCaptureSession } from "../../../src/core/capture/prepare.js";
import { sessionBasenameFor } from "../../../src/core/capture/write-cards.js";

const EARLY = "2026-07-09T13:00:00.000Z"; // when abandoned sessions were last active
const LATE = "2026-07-09T14:30:00.000Z";  // 90 min later — past the 60 min window

const GITIGNORE = ["tmp/", ".callback-box/", "**/*.attach/**/*.webm", "**/*.attach/**/*.jpg"].join("\n") + "\n";

const SCRIPT = {
  "audio-001.webm": {
    text: "Note to self.",
    duration: 3,
    words: [
      { word: "Note", start: 0, end: 1 },
      { word: "to", start: 1, end: 2 },
      { word: "self.", start: 2, end: 3 },
    ],
  },
};

async function configureBox(box) {
  await box.write(".gitignore", GITIGNORE);
  await box.write("config/transcription.json", JSON.stringify({ service: "fake" }));
  await box.write("config/fake-transcription.json", JSON.stringify(SCRIPT, null, 2));
  box.commitAll("configure fake transcription");
}
```

## An abandoned open capture is sealed partial, prepared, and delivered partial

An `open` session with media, untouched for over an hour, is CAS-sealed with
`partial: true` and preparation fires — the capture card gets `partial: true`
frontmatter and the delivered `<capture>` wrapper carries `partial="1"`.

```ts
process.env.CB_TIME = EARLY;
const box = await makeTmpBox({ git: true });
await configureBox(box);

// Stage an open capture with one recording + one photo at 13:00.
const staged = await createStagingSession({ boxRoot: box.root, targetSessionId: null, createdBy: null });
const id = staged.id;
await addAudioChunk({ boxRoot: box.root, id, segmentId: "seg-a", segmentStartedAt: EARLY, filename: "audio-a-001.webm", buffer: Buffer.from("A") });
await addPhoto({ boxRoot: box.root, id, filename: "photo-x.jpg", capturedAt: EARLY, source: "camera-user", buffer: Buffer.from("J") });

const backend = createFakeChatBackend();
const registry = new ChatSessionRegistry(box.root, {
  backend,
  buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }),
});
const eventBus = createEventBus(box.root);

// Advance the clock past the window and sweep, firing (and awaiting) prepare.
process.env.CB_TIME = LATE;
let prep = Promise.resolve();
const result = await sweepAbandonedCaptures({
  boxRoot: box.root,
  firePreparation: (sweptId) => { prep = prepareCaptureSession({ boxRoot: box.root, id: sweptId, eventBus, registry }); },
});
await prep;
await tick();

result.sealed.includes(id)
=> true
```

The committed capture card is marked partial, and the delivered wrapper carries
`partial="1"`:

```ts continue
const basename = sessionBasenameFor({ actualStartedAt: EARLY, id });
const docRel = `tmp-capture/${basename}.capture-session.card`;
(await box.read(docRel)).includes("partial: true")
=> true

const msg = eventBus.readSince(0).find((e) => e.event === "chat-user-message").data.message;
msg.includes("partial=\"1\"")
=> true
```

The staging media was cleaned up once delivered:

```ts continue
await readStagingSession({ boxRoot: box.root, id })
=> null
```

```ts cleanup
registry.shutdown();
eventBus.close();
await box.cleanup();
delete process.env.CB_TIME;
```

## Empty orphans discarded, fresh sessions untouched, stale failures warned

```ts
process.env.CB_TIME = EARLY;
const box = await makeTmpBox({ git: true });
await configureBox(box);

// Empty open session, abandoned at 13:00 → should be discarded.
const empty = await createStagingSession({ boxRoot: box.root, targetSessionId: null, createdBy: null });

// Failed session with media, abandoned at 13:00 → warned, NOT retried.
const failed = await createStagingSession({ boxRoot: box.root, targetSessionId: null, createdBy: null });
await addPhoto({ boxRoot: box.root, id: failed.id, filename: "p.jpg", capturedAt: EARLY, source: "camera-user", buffer: Buffer.from("J") });
await setStagingState({ boxRoot: box.root, id: failed.id, state: "failed:deliver" });

// Advance the clock, then create a FRESH open session with media (active now).
process.env.CB_TIME = LATE;
const fresh = await createStagingSession({ boxRoot: box.root, targetSessionId: null, createdBy: null });
await addPhoto({ boxRoot: box.root, id: fresh.id, filename: "p.jpg", capturedAt: LATE, source: "camera-user", buffer: Buffer.from("J") });

// Sweep with no firePreparation (the seal-only path): sealing still happens.
const result = await sweepAbandonedCaptures({ boxRoot: box.root });

JSON.stringify({ discarded: result.discarded, staleFailed: result.staleFailed, sealed: result.sealed })
=> {"discarded":["«*»"],"staleFailed":["«*»"],"sealed":[]}
```

The empty orphan is gone; the fresh session is untouched (still open); the failed
session is left `failed:deliver`, not re-sealed:

```ts continue
await readStagingSession({ boxRoot: box.root, id: empty.id })
=> null

(await readStagingSession({ boxRoot: box.root, id: fresh.id })).state
=> open

(await readStagingSession({ boxRoot: box.root, id: failed.id })).state
=> failed:deliver
```

The discarded/warned entries are exactly the abandoned ones:

```ts continue
result.discarded[0] === empty.id
=> true

result.staleFailed[0] === failed.id
=> true
```

```ts cleanup
await box.cleanup();
delete process.env.CB_TIME;
```

## A server sweep re-fires a sealed session left by `cb wakeup` (X2)

`cb wakeup`'s seal-only sweep (no runtime) seals abandoned captures but can't
prepare them; a crashed worker also leaves sessions `sealed`/`preparing`/
`delivering`. The periodic *server* sweep (which has `firePreparation`) re-fires
these regardless of age, so they don't strand until the next restart. Here a
session is already `sealed` and recently active — still re-fired:

```ts
process.env.CB_TIME = LATE;
const box = await makeTmpBox({ git: true });
await configureBox(box);

const sealed = await createStagingSession({ boxRoot: box.root, targetSessionId: null, createdBy: null });
await addPhoto({ boxRoot: box.root, id: sealed.id, filename: "p.jpg", capturedAt: LATE, source: "camera-user", buffer: Buffer.from("J") });
await setStagingState({ boxRoot: box.root, id: sealed.id, state: "sealed" });

const fired = [];
const result = await sweepAbandonedCaptures({
  boxRoot: box.root,
  firePreparation: (id) => { fired.push(id); },
});

JSON.stringify({ refired: result.refired, sealed: result.sealed })
=> {"refired":["«*»"],"sealed":[]}
```

The re-fired id is the sealed session, and `firePreparation` was actually called
for it:

```ts continue
result.refired[0] === sealed.id
=> true

fired[0] === sealed.id
=> true
```

Without a runtime (the `cb wakeup` seal-only path), a sealed session is left for
the next server startup — not re-fired here:

```ts continue
const result2 = await sweepAbandonedCaptures({ boxRoot: box.root });
result2.refired.length
=> 0
```

```ts cleanup
await box.cleanup();
delete process.env.CB_TIME;
```
