# Capture preparation worker

`prepareCaptureSession` turns a sealed staging session into a committed capture
document under the target chat's `tmp-capture/`, then delivers a `<capture>`
message. Transcription is scripted via the `fake` service so the whole pipeline
— concat → transcribe → assemble → validate → commit → deliver — runs
deterministically with no API key or Claude subprocess.

```ts setup
import { execFileSync } from "node:child_process";
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
import { prepareCaptureSession } from "../../../src/core/capture/prepare.js";
import { sessionBasenameFor } from "../../../src/core/capture/write-cards.js";
import { buildCaptureWrapper } from "../../../src/core/capture/deliver.js";

const GITIGNORE = ["tmp/", ".callback-box/", "**/*.attach/**/*.webm", "**/*.attach/**/*.jpg"].join("\n") + "\n";

// Scripted transcription, keyed by the concatenated clip filename.
const SCRIPT = {
  "audio-001.webm": {
    text: "Walked through the kitchen.",
    duration: 4,
    words: [
      { word: "Walked", start: 0, end: 1 },
      { word: "through", start: 1, end: 2 },
      { word: "the", start: 2, end: 3 },
      { word: "kitchen.", start: 3, end: 4 },
    ],
  },
  "audio-002.webm": {
    text: "Found the recipe.",
    duration: 3,
    words: [
      { word: "Found", start: 0, end: 1 },
      { word: "the", start: 1, end: 2 },
      { word: "recipe.", start: 2, end: 3 },
    ],
  },
};

// Stage a sealed session: two audio segments (14:00:00, 14:00:30) + one photo
// (14:00:15). Media bytes are placeholders — the fake service keys on filenames.
async function stageSealedSession(boxRoot) {
  const staged = await createStagingSession({ boxRoot, targetSessionId: null });
  const id = staged.id;
  await addAudioChunk({ boxRoot, id, segmentId: "seg-a", segmentStartedAt: "2026-07-09T14:00:00.000Z", filename: "audio-a-001.webm", buffer: Buffer.from("A") });
  await addAudioChunk({ boxRoot, id, segmentId: "seg-b", segmentStartedAt: "2026-07-09T14:00:30.000Z", filename: "audio-b-001.webm", buffer: Buffer.from("B") });
  await addPhoto({ boxRoot, id, filename: "photo-x.jpg", capturedAt: "2026-07-09T14:00:15.000Z", source: "camera-user", buffer: Buffer.from("J") });
  await setStagingState({ boxRoot, id, state: "sealed" });
  return id;
}

async function configureBox(box) {
  await box.write(".gitignore", GITIGNORE);
  await box.write("config/transcription.json", JSON.stringify({ service: "fake" }));
  await box.write("config/fake-transcription.json", JSON.stringify(SCRIPT, null, 2));
  box.commitAll("configure fake transcription");
}
```

## Full prepare: cards, timing sidecars, exact timeline, commit, wrapper

```ts
const box = await makeTmpBox({ git: true });
await configureBox(box);
const id = await stageSealedSession(box.root);

const backend = createFakeChatBackend();
const registry = new ChatSessionRegistry(box.root, {
  backend,
  buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }),
});
const eventBus = createEventBus(box.root);

await prepareCaptureSession({ boxRoot: box.root, id, eventBus, registry });
await tick();

const basename = sessionBasenameFor({ actualStartedAt: "2026-07-09T14:00:00.000Z", id });
const attach = `tmp-capture/${basename}.attach`;
const docRel = `tmp-capture/${basename}.capture-session.card`;
```

One capture card, one audio card per segment, both transcribed:

```ts continue
(await box.read(docRel)).includes(`session-id: ${id}`)
=> true

(await box.read(`${attach}/audio-001.audio.card`)).includes("status: transcribed")
=> true

(await box.read(`${attach}/audio-002.audio.card`)).includes("status: transcribed")
=> true
```

Each clip has a `.timing.json` sidecar with its words:

```ts continue
JSON.parse(await box.read(`${attach}/audio-001.attach/audio-001.timing.json`)).words.length
=> 4
```

The assembled body interleaves speech, the photo, and the silence gap in
absolute-time order (silence is measured from the last word before the gap):

```ts continue
JSON.stringify(splitCardContent(await box.read(docRel)).body.trim())
=> "Walked through the kitchen.\n\n{% image ref=\"attach/photo-001.image.card\" /%}\n\n{% silence duration=\"26s\" /%}\n\nFound the recipe."
```

The document is committed with the capture message + trailer:

```ts continue
execFileSync("git", ["log", "-1", "--format=%s"], { cwd: box.root }).toString().trim()
=> Capture: «*»

execFileSync("git", ["log", "-1", "--format=%(trailers:key=Created-By,valueonly)"], { cwd: box.root }).toString().trim()
=> capture
```

Delivery injected the `<capture>` wrapper as a chat-user-message, and a
`capture-status` delivered event fired with the doc path:

```ts continue
const events = eventBus.readSince(0);
const expectedWrapper = buildCaptureWrapper({ docPath: docRel, imageCount: 1, audioSeconds: 7, summary: "Walked through the kitchen." });
events.find((e) => e.event === "chat-user-message").data.message === expectedWrapper
=> true

const delivered = events.find((e) => e.event === "capture-status" && e.data.status === "delivered");
delivered.data.docPath
=> «*»
```

The staging session's media was cleaned up once delivered:

```ts continue
await readStagingSession({ boxRoot: box.root, id })
=> null
```

```ts cleanup
registry.shutdown();
eventBus.close();
await box.cleanup();
```

## Idempotent resume: a failed delivery retries without duplicating work

A delivery failure leaves the committed document in place and the session in
`failed:deliver`; re-running preparation skips straight to delivery and does not
re-write, re-transcribe, or re-commit.

```ts
const box = await makeTmpBox({ git: true });
await configureBox(box);
const id = await stageSealedSession(box.root);
const eventBus = createEventBus(box.root);

// A registry whose first send() fails, then succeeds — simulating a transient
// delivery error followed by a retry (the resume path).
let failNext = true;
const session = {
  isBusy: () => false,
  enqueue: () => {},
  send: async () => { if (failNext) { failNext = false; return false; } return true; },
  getSessionId: () => "sess-1",
};
const registry = {
  getOrCreate: () => session,
  createNew: () => session,
  get: () => session,
  enforceLiveCap: () => {},
  touch: () => {},
  markMostActive: async () => {},
};

await prepareCaptureSession({ boxRoot: box.root, id, eventBus, registry });
(await readStagingSession({ boxRoot: box.root, id })).state
=> failed:deliver
```

The document is committed exactly once, and the body is assembled:

```ts continue
const basename = sessionBasenameFor({ actualStartedAt: "2026-07-09T14:00:00.000Z", id });
const docRel = `tmp-capture/${basename}.capture-session.card`;
const bodyAfterFirst = splitCardContent(await box.read(docRel)).body.trim();
bodyAfterFirst.startsWith("Walked through the kitchen.")
=> true

execFileSync("git", ["log", "--format=%s"], { cwd: box.root }).toString().split("\n").filter((l) => l.startsWith("Capture:")).length
=> 1
```

Re-running preparation delivers (send succeeds now) with no duplicate cards or
commits, and the body is unchanged:

```ts continue
await prepareCaptureSession({ boxRoot: box.root, id, eventBus, registry });

(await readStagingSession({ boxRoot: box.root, id }))
=> null

splitCardContent(await box.read(docRel)).body.trim() === bodyAfterFirst
=> true

execFileSync("git", ["log", "--format=%s"], { cwd: box.root }).toString().split("\n").filter((l) => l.startsWith("Capture:")).length
=> 1
```

```ts cleanup
eventBus.close();
await box.cleanup();
```
