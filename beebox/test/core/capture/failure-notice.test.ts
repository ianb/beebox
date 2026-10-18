// # Capture failure notice
//
// A capture that fails for good (`markCapturePreparationFailed`) flips its
// pending bubble to failed and, when nobody is present in the app, sends one
// `quiet` notification to the chat it was headed for, with the reason in one
// sentence. See docs/implemented-plans/notifications.md (Track E).

import { test } from "tap";
import "agent-doctest/tap";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { boxSlug } from "../../../src/lib/box-slug.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { createStagingSession } from "../../../src/core/capture/staging-store/core.js";
import { markCapturePreparationFailed } from "../../../src/core/capture/prepare/core.js";
import { addSubscription } from "../../../src/core/push-subscriptions.js";
import { createFakePush } from "../../../src/services/push.js";
import { readRecent } from "../../../src/core/notification/log.js";
import { writePresence } from "../../../src/core/notification/presence.js";
import type { EventBus } from "../../../src/core/event-bus/core.js";

const storeDir = path.join(os.tmpdir(), `bbx-capture-notice-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;
for (const name of ["BBX_NOTIFY_FAKE", "BBX_PUSH_FAKE"]) delete process.env[name];

const SUB = { endpoint: "https://push.example/capture", keys: { p256dh: "p", auth: "a" } };
const emitted: string[] = [];
function statusOf(data: unknown): string {
  return typeof data === "object" && data !== null && "status" in data ? String(data.status) : "";
}
// Only `emit` is observed; the rest of the bus is inert.
const eventBus: EventBus = {
  emit: (name: string, data: unknown) => { emitted.push(`${name} ${statusOf(data)}`); return 0; },
  emitTransient: () => {},
  readSince: () => [],
  readRecent: () => [],
  subscribe: () => ({ unsubscribe: () => {} }),
  prune: () => 0,
  close: () => {},
};

// ## Nobody present: one `quiet` notice to the capture's chat
void test("Nobody present: one `quiet` notice to the capture's chat", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await fs.rm(storeDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L47
  const box = await makeTmpBox({ git: true });
  await addSubscription({ boxSlug: await boxSlug(box.root), subscription: SUB, now: new Date() });
  const push = createFakePush();
  const staged = await createStagingSession({ boxRoot: box.root, targetSessionId: "sess-1", createdBy: null });

  // doctest:L52
  await markCapturePreparationFailed({
    boxRoot: box.root, id: staged.id, eventBus, services: { push },
    reason: "The capture was saved, but it could not be delivered to the chat.",
  });
  t.check(emitted.join("\n"), "capture-status failed");

  // doctest:L59
  const [notice] = await readRecent(box.root, { days: 1 });
  assert.ok(notice);
  const { title, body, target, loudness, source } = notice.intent;
  t.check({ title, body, target, loudness, source }, {
    title: "A capture could not be finished",
    body: "The capture was saved, but it could not be delivered to the chat.",
    target: "chat:sess-1",
    loudness: "quiet",
    source: "capture",
  });

  // doctest:L71
  await t.checkText(push.sent.length, "1");

  // ## Someone present: nothing is sent
  //
  // The open app already shows the failed capture bubble.

  // doctest:L80
  await writePresence(box.root, { activeWeb: 1, now: new Date() });
  await markCapturePreparationFailed({ boxRoot: box.root, id: staged.id, eventBus, services: { push }, reason: "Again." });
  t.check(`${(await readRecent(box.root, { days: 1 })).length} | ${push.sent.length}`, "1 | 1");
});
