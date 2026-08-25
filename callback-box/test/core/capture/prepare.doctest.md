# Capture preparation worker

`prepareCaptureSession` turns a sealed staging session into a committed capture
document under the target chat's `tmp-capture/`, then delivers a `<capture>`
message. Transcription is scripted via the `fake` service so the whole pipeline
— concat → transcribe → assemble → validate → commit → deliver — runs
deterministically with no API key or Claude subprocess.

```ts setup
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, appendFile, readFile, rm, access } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { splitCardContent } from "../../../src/cards/index.js";
import { createEventBus } from "../../../src/core/event-bus.js";
import { ChatSessionRegistry } from "../../../src/core/chat/session/registry.js";
import { createFakeChatBackend } from "../../../src/services/claude-chat.js";
import { plainTestPrompt, tick } from "../../helpers/chat-session-spawner-helpers.js";
import { appendHistory, resolveSessionLogPath } from "../../../src/core/chat/session/history.js";
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

async function pathExists(p) {
  try { await access(p); return true; } catch { return false; }
}

// Arrow-free-at-call-site git inspection (keeps inline `=>` out of example
// blocks, where the doctest tracker confuses arrows with assertion markers).
function commitReport(boxRoot, baseA, baseB) {
  const rows = execFileSync("git", ["log", "--format=%H%x09%s"], { cwd: boxRoot })
    .toString().trim().split("\n").map((l) => l.split("\t"));
  const subjectA = "Capture: " + baseA;
  const subjectB = "Capture: " + baseB;
  const countA = rows.filter((r) => r[1] === subjectA).length;
  const countB = rows.filter((r) => r[1] === subjectB).length;
  const rowA = rows.find((r) => r[1] === subjectA);
  const rowB = rows.find((r) => r[1] === subjectB);
  function filesOf(hash) {
    return execFileSync("git", ["show", "--name-only", "--format=", hash], { cwd: boxRoot })
      .toString().trim().split("\n").filter(Boolean);
  }
  const filesA = rowA ? filesOf(rowA[0]) : [];
  const filesB = rowB ? filesOf(rowB[0]) : [];
  const aIsolated = filesA.length > 0 && filesA.every((f) => f.includes(baseA)) && !filesA.some((f) => f.includes(baseB));
  const bIsolated = filesB.length > 0 && filesB.every((f) => f.includes(baseB)) && !filesB.some((f) => f.includes(baseA));
  // Single combined verdict: each capture committed exactly once, and each
  // commit's files belong only to that capture (the F1 cross-contamination fix).
  return countA === 1 && countB === 1 && aIsolated && bIsolated;
}

const GITIGNORE = ["tmp/", ".callback-box/", "**/*.attach/**/*.webm", "**/*.attach/**/*.m4a", "**/*.attach/**/*.jpg"].join("\n") + "\n";

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
  "audio-001.m4a": {
    text: "Native audio survived.",
    duration: 2,
    words: [
      { word: "Native", start: 0, end: 0.5 },
      { word: "audio", start: 0.5, end: 1 },
      { word: "survived.", start: 1, end: 2 },
    ],
  },
};

// Stage a sealed session: two audio segments (14:00:00, 14:00:30) + one photo
// (14:00:15). Media bytes are placeholders — the fake service keys on filenames.
async function stageSealedSession(boxRoot) {
  const staged = await createStagingSession({ boxRoot, targetSessionId: null, createdBy: null });
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

One capture card, one audio card per segment, both transcribed — and with
nothing left untranscribed, the card carries no `transcription-failed` flag:

```ts continue
(await box.read(docRel)).includes(`session-id: ${id}`)
=> true

(await box.read(docRel)).includes("transcription-failed")
=> false

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

The document is committed with the capture message + trailer, and delivery
flipped the card `new` → `delivered` in a second (card-only) commit:

```ts continue
const subjects = execFileSync("git", ["log", "--format=%s"], { cwd: box.root }).toString().trim().split("\n");
subjects.filter((s) => s.startsWith("Capture: ")).length
=> 1

subjects.filter((s) => s.startsWith("Capture delivered: ")).length
=> 1

execFileSync("git", ["log", "--format=%(trailers:key=Created-By,valueonly)"], { cwd: box.root }).toString().includes("capture")
=> true

(await box.read(docRel)).includes("status: delivered")
=> true
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

## Native M4A stays M4A through preparation

A native segment is one complete M4A file. Preparation must not concatenate it
under a WebM extension; transcription and the audio card both see `.m4a`.

```ts
const box = await makeTmpBox({ git: true });
await box.write(".gitignore", GITIGNORE);
await box.write("config/transcription.json", JSON.stringify({ service: "fake" }));
await box.write("config/fake-transcription.json", JSON.stringify({ "audio-001.m4a": SCRIPT["audio-001.m4a"] }, null, 2));
box.commitAll("configure native transcription");
const staged = await createStagingSession({ boxRoot: box.root, targetSessionId: null, createdBy: null });
await addAudioChunk({
  boxRoot: box.root,
  id: staged.id,
  segmentId: "native-segment",
  segmentStartedAt: "2026-07-09T15:00:00.000Z",
  filename: "ios-audio.m4a",
  buffer: Buffer.from("COMPLETE-M4A"),
  audioFormat: "m4a-aac",
});
await setStagingState({ boxRoot: box.root, id: staged.id, state: "sealed" });
const backend = createFakeChatBackend();
const registry = new ChatSessionRegistry(box.root, {
  backend,
  buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }),
});
const eventBus = createEventBus(box.root);
await prepareCaptureSession({ boxRoot: box.root, id: staged.id, eventBus, registry });
await tick();
const basename = sessionBasenameFor({ actualStartedAt: "2026-07-09T15:00:00.000Z", id: staged.id });
const attach = `tmp-capture/${basename}.attach`;
JSON.stringify({
  media: await box.read(`${attach}/audio-001.attach/audio-001.m4a`),
  cardNamesM4A: (await box.read(`${attach}/audio-001.audio.card`)).includes("ref: attach/audio-001.m4a"),
})
=> {"media":"COMPLETE-M4A","cardNamesM4A":true}
```

```ts cleanup
registry.shutdown();
eventBus.close();
await box.cleanup();
```

## Partial transcription: the failed clip is flagged and visibly marked (F4)

When only some clips transcribe, the capture is delivered anyway with
`transcription-failed`, the summary comes from a clip that DID transcribe, and
the untranscribed clip gets a visible marker in the timeline instead of being
silently dropped.

```ts
const box = await makeTmpBox({ git: true });
await box.write(".gitignore", GITIGNORE);
await box.write("config/transcription.json", JSON.stringify({ service: "fake" }));
// Script only the first segment's clip; the second clip fails to transcribe.
await box.write("config/fake-transcription.json", JSON.stringify({ "audio-001.webm": SCRIPT["audio-001.webm"] }, null, 2));
box.commitAll("partial script");
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
const partialBody = splitCardContent(await box.read(`tmp-capture/${basename}.capture-session.card`)).body;
partialBody.includes("[audio clip 2 not transcribed]")
=> true
```

The card itself records the failure in frontmatter, so an agent annotating it
later — possibly with no `<capture>` message in view — sees why the audio card
is still `new`:

```ts continue
(await box.read(`tmp-capture/${basename}.capture-session.card`)).includes("transcription-failed: true")
=> true
```

The delivered wrapper carries `transcription-failed`, with the summary taken
from the clip that succeeded (not the failed clip 0-or-2):

```ts continue
const captureMsg = eventBus.readSince(0).find((e) => e.event === "chat-user-message").data.message;
captureMsg.includes("transcription-failed=\"1\"")
=> true

captureMsg.includes("Walked through the kitchen.")
=> true
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
  // No chat here was coined and reserved (chat/session/reserve.ts).
  getReservation: () => null,
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

## Two concurrent preparations commit independently (pathspec-scoped)

Two staged sessions prepared via `Promise.all` must each produce their own
commit touching only their own files — the pathspec-scoped, serialized commit
never sweeps the other worker's staged files under the wrong message.

```ts
const box = await makeTmpBox({ git: true });
await configureBox(box);
const idA = await stageSealedSession(box.root);
const idB = await stageSealedSession(box.root);

const backend = createFakeChatBackend();
const registry = new ChatSessionRegistry(box.root, {
  backend,
  buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }),
});
const eventBus = createEventBus(box.root);

await Promise.all([
  prepareCaptureSession({ boxRoot: box.root, id: idA, eventBus, registry }),
  prepareCaptureSession({ boxRoot: box.root, id: idB, eventBus, registry }),
]);
await tick();

const baseA = sessionBasenameFor({ actualStartedAt: "2026-07-09T14:00:00.000Z", id: idA });
const baseB = sessionBasenameFor({ actualStartedAt: "2026-07-09T14:00:00.000Z", id: idB });
const capSubjects = execFileSync("git", ["log", "--format=%s"], { cwd: box.root }).toString().trim().split("\n");
capSubjects.filter((s) => s.startsWith("Capture: ")).length
=> 2

capSubjects.filter((s) => s.startsWith("Capture delivered: ")).length
=> 2
```

Each capture committed exactly once and each commit touches only its own files —
no cross-contamination (the F1 fix). The report helper does the arrow-heavy
inspection out of the example block and returns a single verdict:

```ts continue
commitReport(box.root, baseA, baseB)
=> true
```

Both delivered — their staging media was cleaned up:

```ts continue
await readStagingSession({ boxRoot: box.root, id: idA })
=> null
```

```ts continue
await readStagingSession({ boxRoot: box.root, id: idB })
=> null
```

```ts cleanup
registry.shutdown();
eventBus.close();
await box.cleanup();
```

## Double-delivery resume: the at-most-once probe suppresses a re-send

A crash after `send()` resolved (the message reached the transcript) but before
the `delivered` marker was written leaves the session in `delivering`. On resume,
the at-most-once probe finds the message already in the target chat's transcript
(matched by the unique `doc="…"`) and finishes the bookkeeping without a second
send — so exactly one `<capture>` message lands.

```ts
const box = await makeTmpBox({ git: true });
await configureBox(box);
const id = await stageSealedSession(box.root);

// The capture targets a known chat; seed its history + an (initially empty)
// transcript JSONL that the mock send writes into.
await setStagingState({ boxRoot: box.root, id, state: "sealed" });
await appendHistory(box.root, { sessionId: "s-known" });
const logPath = await resolveSessionLogPath(box.root, "s-known");
await mkdir(dirname(logPath), { recursive: true });
await writeFile(logPath, "");

// Rewire the staged session's target to the known chat.
const staged = await readStagingSession({ boxRoot: box.root, id });
staged.targetSessionId = "s-known";
await writeFile(`${box.root}/tmp/capture-staging/${id}/session.json`, JSON.stringify(staged, null, 2));

let sendCount = 0;
let crashOnSend = true;
const session = {
  isBusy: () => false,
  enqueue: () => {},
  getSessionId: () => "s-known",
  send: async (input) => {
    sendCount += 1;
    await appendFile(logPath, JSON.stringify({ type: "user", text: input.text }) + "\n");
    if (crashOnSend) throw new Error("simulated crash after send, before delivered marker");
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

// First run: send lands the message, then "crashes" before the delivered write.
await prepareCaptureSession({ boxRoot: box.root, id, eventBus: createEventBus(box.root), registry }).catch(() => {});
sendCount
=> 1

(await readStagingSession({ boxRoot: box.root, id })).state
=> delivering
```

Resume: the probe short-circuits delivery — no second send, still one message:

```ts continue
crashOnSend = false;
await prepareCaptureSession({ boxRoot: box.root, id, eventBus: createEventBus(box.root), registry });

sendCount
=> 1

(await readFile(logPath, "utf-8")).split("\n").filter((l) => l.includes("<capture ")).length
=> 1

await readStagingSession({ boxRoot: box.root, id })
=> null

const basename = sessionBasenameFor({ actualStartedAt: "2026-07-09T14:00:00.000Z", id });
(await box.read(`tmp-capture/${basename}.capture-session.card`)).includes("status: delivered")
=> true
```

```ts cleanup
await rm(dirname(logPath), { recursive: true, force: true });
await box.cleanup();
```

## Validation failure deletes the written cards and dead-ends cleanly (F6)

A card that fails validation must not leave orphaned uncommitted files that
re-fire identically forever. Pre-seeding an invalid capture card (so the write
step is skipped and validation runs on it) drives the `failed:assemble` path:

```ts
const box = await makeTmpBox({ git: true });
await configureBox(box);
const id = await stageSealedSession(box.root);

const basename = sessionBasenameFor({ actualStartedAt: "2026-07-09T14:00:00.000Z", id });
const cardRel = `tmp-capture/${basename}.capture-session.card`;
const attachRel = `tmp-capture/${basename}.attach`;
// Seed an invalid card (bogus status enum, no session-id) + an empty attach dir,
// so prepare skips the write step and validates the pre-seeded card.
await mkdir(`${box.root}/${attachRel}`, { recursive: true });
await writeFile(`${box.root}/${cardRel}`, "---\nstatus: not-a-real-status\n---\n");

const registry = {
  getOrCreate: () => ({ isBusy: () => false, enqueue: () => {}, send: async () => true, getSessionId: () => "x" }),
  createNew: () => ({ isBusy: () => false, enqueue: () => {}, send: async () => true, getSessionId: () => "x" }),
  get: () => null, enforceLiveCap: () => {}, touch: () => {}, markMostActive: async () => {},
};
await prepareCaptureSession({ boxRoot: box.root, id, eventBus: createEventBus(box.root), registry });

(await readStagingSession({ boxRoot: box.root, id })).state
=> failed:assemble
```

The invalid files this run wrote are deleted — no orphaned uncommitted files,
working tree clean, so a re-fire rebuilds from scratch:

```ts continue
await pathExists(`${box.root}/${cardRel}`)
=> false

await pathExists(`${box.root}/${attachRel}`)
=> false

execFileSync("git", ["status", "--short"], { cwd: box.root }).toString().trim().length
=> 0
```

```ts cleanup
await box.cleanup();
```

## Fully-gitignored attach scope still commits the card and delivers

Post-annex boxes gitignore the whole capture staging attach scope
(`**/tmp-capture/**/*.attach/**` — staging media joins the annex only when an
agent files it, see `docs/plans/asset-annex.md`). `git add` then stages nothing
from the attach directory, and a commit pathspec naming it would fail with
"pathspec did not match any file(s) known to git" — the 2026-08-03 box-family
incident: every capture wedged in `preparing` and the client retried forever.
Preparation must commit only what actually staged (the session card) and still
deliver.

```ts
const box = await makeTmpBox({ git: true });
await box.write(".gitignore", GITIGNORE + "**/tmp-capture/**/*.attach/**\n");
await box.write("config/transcription.json", JSON.stringify({ service: "fake" }));
await box.write("config/fake-transcription.json", JSON.stringify(SCRIPT, null, 2));
box.commitAll("configure fake transcription, annex-style ignore");
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
const docRel = `tmp-capture/${basename}.capture-session.card`;
const attachRel = `tmp-capture/${basename}.attach`;
```

The capture delivered (staging cleaned up) and the card was committed —
flipped to `delivered` — while the attach files exist on disk untracked:

```ts continue
await readStagingSession({ boxRoot: box.root, id })
=> null

(await box.read(docRel)).includes("status: delivered")
=> true

await pathExists(`${box.root}/${attachRel}/audio-001.audio.card`)
=> true

const capSubjects = execFileSync("git", ["log", "--format=%s"], { cwd: box.root }).toString();
capSubjects.includes(`Capture: ${basename}`)
=> true

execFileSync("git", ["ls-files", "--", attachRel], { cwd: box.root }).toString().trim()
=> 
```

```ts cleanup
registry.shutdown();
eventBus.close();
await box.cleanup();
```
