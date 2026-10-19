// # push-send: server-level subscription store + sender
//
// Web Push subscriptions are stored once, server-wide, keyed by endpoint, with
// each record carrying the box slugs that endpoint opted into (a PushSubscription
// is bound to its SW registration, not a box). `sendPush` delivers to the
// endpoints opted into a box and prunes any the push service reports gone —
// pruning removes the endpoint from *every* box at once. See
// `docs/plans/web-push-notifications.md` (Track B).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import { boxSlug } from "../../src/lib/box-slug.js";
import { addSubscription, endpointsForBox } from "../../src/core/push-subscriptions.js";
import { sendPush } from "../../src/core/send-push.js";
import { createFakePush } from "../../src/services/push.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

// Isolate the server-level store in a temp dir for this test file.
const storeDir = path.join(os.tmpdir(), `bbx-push-store-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;

const SUB_A = { endpoint: "https://push.example/a", keys: { p256dh: "pa", auth: "aa" } };
const SUB_B = { endpoint: "https://push.example/b", keys: { p256dh: "pb", auth: "ab" } };
const NOW = new Date("2026-06-29T12:00:00Z");

// ## Same endpoint under two boxes is stored once
void test("Same endpoint under two boxes is stored once", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await fs.rm(storeDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L32
  const box = await makeTmpBox();
  const slug = await boxSlug(box.root);

  // doctest:L35
  await addSubscription({ boxSlug: slug, subscription: SUB_A, now: NOW });
  await addSubscription({ boxSlug: "other", subscription: SUB_A, now: NOW });

  // doctest:L38
  const forSlug = await endpointsForBox(slug);
  const forOther = await endpointsForBox("other");
  t.check(forSlug, [SUB_A]);
  t.check(forOther, [SUB_A]);

  // ## sendPush delivers healthy endpoints and prunes gone ones

  // doctest:L47
  await addSubscription({ boxSlug: slug, subscription: SUB_B, now: NOW });
  const fake = createFakePush({ goneEndpoints: [SUB_A.endpoint] });
  const result = await sendPush(box.root, {
    payload: { title: "Health", body: "task overdue", url: `/${slug}/health` },
    push: fake,
  });
  t.check(result, {
    sent: 1,
    pruned: 1,
    failed: 0,
  });

  // ## Pruning removed the endpoint from every box, and only B was delivered

  // doctest:L60
  const stillOther = await endpointsForBox("other");
  await t.checkText(fake.describe(), `FakePush: 1 sent
  https://push.example/b → Health: task overdue`);

  // doctest:L67
  t.check(stillOther, []);

  // ## A payload-only debug line was written (no endpoints or keys)

  // doctest:L74
  const log = await fs.readFile(path.join(box.root, ".beebox", "push-debug.log"), "utf-8");
  const entry = JSON.parse(log.trim());
  t.check(entry, {
    sentAt: isoDate(),
    boxSlug: slug,
    title: "Health",
    body: "task overdue",
    url: `/${slug}/health`,
    sent: 1,
    pruned: 1,
    failed: 0,
  });
});
