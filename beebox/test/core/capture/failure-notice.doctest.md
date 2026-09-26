# Capture failure notice

A capture that fails for good (`markCapturePreparationFailed`) flips its
pending bubble to failed and, when nobody is present in the app, sends one
`quiet` notification to the chat it was headed for, with the reason in one
sentence. See docs/plans/notifications.md (Track E).

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { boxSlug } from "../../../src/lib/box-slug.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { createStagingSession } from "../../../src/core/capture/staging-store.js";
import { markCapturePreparationFailed } from "../../../src/core/capture/prepare.js";
import { addSubscription } from "../../../src/core/push-subscriptions.js";
import { createFakePush } from "../../../src/services/push.js";
import { readRecent } from "../../../src/core/notification/log.js";
import { writePresence } from "../../../src/core/notification/presence.js";

const storeDir = path.join(os.tmpdir(), `bbx-capture-notice-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;
for (const name of ["BBX_NOTIFY_FAKE", "BBX_PUSH_FAKE"]) delete process.env[name];

const SUB = { endpoint: "https://push.example/capture", keys: { p256dh: "p", auth: "a" } };
const emitted = [];
const eventBus = { emit: (name, data) => { emitted.push(`${name} ${data.status}`); return 0; } };
```

## Nobody present: one `quiet` notice to the capture's chat

```ts
const box = await makeTmpBox({ git: true });
await addSubscription({ boxSlug: await boxSlug(box.root), subscription: SUB, now: new Date() });
const push = createFakePush();
const staged = await createStagingSession({ boxRoot: box.root, targetSessionId: "sess-1", createdBy: null });

await markCapturePreparationFailed({
  boxRoot: box.root, id: staged.id, eventBus, services: { push },
  reason: "The capture was saved, but it could not be delivered to the chat.",
});
emitted.join("\n")
=> capture-status failed

const [notice] = await readRecent(box.root, { days: 1 });
const { title, body, target, loudness, source } = notice.intent;
JSON.stringify({ title, body, target, loudness, source }, null, 1)
=> {
 "title": "A capture could not be finished",
 "body": "The capture was saved, but it could not be delivered to the chat.",
 "target": "chat:sess-1",
 "loudness": "quiet",
 "source": "capture"
}

push.sent.length
=> 1
```

## Someone present: nothing is sent

The open app already shows the failed capture bubble.

```ts continue
await writePresence(box.root, { activeWeb: 1, now: new Date() });
await markCapturePreparationFailed({ boxRoot: box.root, id: staged.id, eventBus, services: { push }, reason: "Again." });
`${(await readRecent(box.root, { days: 1 })).length} | ${push.sent.length}`
=> 1 | 1
```

```ts cleanup
await box.cleanup();
await fs.rm(storeDir, { recursive: true, force: true });
```
