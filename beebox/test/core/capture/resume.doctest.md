# Capture staging resume scan

On webapp startup, `resumeStagingSessions` re-fires preparation for any capture
session left `sealed`/`preparing`/`delivering` by a crash or restart. Voice
sessions (`docs/plans/resilient-voice-recording.md`) resume through their own
path (a later chunk), so this scan must skip them even when one sits in the
same in-flight states.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { createEventBus } from "../../../src/core/event-bus.js";
import { ChatSessionRegistry } from "../../../src/core/chat/session/registry.js";
import { createFakeChatBackend } from "../../../src/services/claude-chat.js";
import { plainTestPrompt, tick } from "../../helpers/chat-session-spawner-helpers.js";
import {
  createStagingSession,
  addPhoto,
  setStagingState,
  readStagingSession,
} from "../../../src/core/capture/staging-store.js";
import { resumeStagingSessions } from "../../../src/core/capture/resume.js";

const GITIGNORE = ["_tmp/", ".beebox/", "**/*.attach/**/*.jpg"].join("\n") + "\n";

async function configureBox(box) {
  await box.write(".gitignore", GITIGNORE);
  await box.write("_config/transcription.json", JSON.stringify({ service: "fake" }));
  await box.write("_config/fake-transcription.json", "{}");
  box.commitAll("configure fake transcription");
}

// resumeStagingSessions fires prepareCaptureSession fire-and-forget, so
// completion isn't observable from a fixed number of microtask ticks — poll
// until the capture session is cleaned up (delivered) or the timeout lapses.
async function waitForGone(boxRoot, id, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const session = await readStagingSession({ boxRoot, id });
    if (session === null) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}
```

## A sealed capture session resumes; a sealed voice session does not

```ts
const box = await makeTmpBox({ git: true });
await configureBox(box);

const capture = await createStagingSession({ boxRoot: box.root, targetSessionId: null, createdBy: null });
await addPhoto({
  boxRoot: box.root, id: capture.id, filename: "p.jpg", capturedAt: "2026-07-09T14:00:00.000Z",
  source: "camera-user", buffer: Buffer.from("J"),
});
await setStagingState({ boxRoot: box.root, id: capture.id, state: "sealed" });

const voice = await createStagingSession({
  boxRoot: box.root, targetSessionId: "chat-voice", createdBy: null, kind: "voice",
});
await setStagingState({ boxRoot: box.root, id: voice.id, state: "sealed" });

const backend = createFakeChatBackend();
const registry = new ChatSessionRegistry(box.root, {
  backend,
  buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }),
});
const eventBus = createEventBus(box.root);

await resumeStagingSessions({ boxRoot: box.root, eventBus, registry });
const captureDelivered = await waitForGone(box.root, capture.id);
await tick();
```

The capture session was picked up and delivered (no longer sitting `sealed` on
disk — `prepareCaptureSession` cleans it up once delivered):

```ts continue
captureDelivered
=> true
```

The voice session was left completely untouched — still `sealed`, and its
`voice` object unchanged, because resume never dispatched into it:

```ts continue
const voiceAfter = await readStagingSession({ boxRoot: box.root, id: voice.id });
JSON.stringify({ state: voiceAfter.state, hq: voiceAfter.voice.hq, handoff: voiceAfter.voice.handoff })
=> {"state":"sealed","hq":{"state":"none"},"handoff":{"mode":"open"}}
```

```ts cleanup
await box.cleanup();
```
