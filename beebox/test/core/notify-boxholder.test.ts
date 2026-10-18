// # notifyBoxholder: log, decide, deliver once
//
// `notifyBoxholder` is the one way the box reaches the person. It appends the
// intent to `.beebox/notifications.jsonl`, emits a live `notification` event for
// open apps, picks channels from the loudness, the audience, and presence, sends
// once on each in process, and appends one delivery line per channel. There is no
// queue and no retry: a failure is a `failed` line, and the notification health
// checks report it.

import { test } from "tap";
import "agent-doctest/tap";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox, type TmpBox } from "../helpers/doctest-helpers.js";
import { notifyBoxholder, notifyChannels, type NotificationInput } from "../../src/core/notify-boxholder.js";
import type { Loudness } from "../../src/core/notification/intent.js";
import { eventSchemas } from "../../src/core/event-bus/schemas.js";
import { addSubscription } from "../../src/core/push-subscriptions.js";
import { createFakePush } from "../../src/services/push.js";
import { createEventBus } from "../../src/core/event-bus/core.js";
import { readRecent, notificationLogPath } from "../../src/core/notification/log.js";
import { writePresence } from "../../src/core/notification/presence.js";
import { notificationHealthChecks } from "../../src/core/notification/health.js";

const storeDir = path.join(os.tmpdir(), `bbx-notify-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;
// No VAPID keys, forced-fake push, or public URL unless a section sets them.
for (const name of ["BBX_VAPID_PUBLIC_KEY", "BBX_VAPID_PRIVATE_KEY", "BBX_NOTIFY_FAKE", "BBX_PUSH_FAKE", "BBX_APNS_KEY_PATH", "BBX_APNS_KEY_ID", "BBX_APNS_TEAM_ID", "BBX_APNS_BUNDLE_ID", "BBX_PUBLIC_URL", "PUBLIC_URL"]) delete process.env[name];

const NOW = new Date("2026-09-26T12:00:00Z");
const SUB = { endpoint: "https://push.example/phone", keys: { p256dh: "p", auth: "a" } };

// A box whose boxholder subscribed a browser.
async function reachableBox() {
  const box = await makeTmpBox({ git: true });
  await addSubscription({ boxSlug: await boxSlug(box.root), subscription: SUB, now: NOW });
  return box;
}

function intent(loudness: Loudness): NotificationInput {
  return {
    title: "Field trip form due Friday",
    body: "The school emailed: the form is due Friday.",
    target: { kind: "card", path: "_content/inbox/field-trip.email.card" },
    loudness,
    source: "notify-doctest",
  };
}

async function logged(box: TmpBox) {
  const [n] = await readRecent(box.root, { days: 1, now: NOW });
  return (n?.deliveries ?? []).map((d) => `${d.channel} ${d.status}${d.detail ? `: ${d.detail}` : ""}`).join("\n");
}

async function failing(box: TmpBox) {
  const checks = await notificationHealthChecks(box.root, { now: NOW });
  return checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.message}`).join("\n") || "all ok";
}

// ## `loud` with a subscribed browser: one send
//
// APNs has no audience until paired phones register, so it is a skip. Web push
// sends.
void test("APNs has no audience until paired phones register, so it is a skip.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L68
  const box = await reachableBox();
  const push = createFakePush();
  const result = await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW, services: { push } });

  // doctest:L72
  await t.checkText(await logged(box), `apns skipped: no-audience
web-push sent`);

  // The push carries the rendered deep link and makes a sound:

  // doctest:L81
  const slug = await boxSlug(box.root);
  await t.checkText(push.sent[0]?.payload.url === `/${slug}/browse/_content/inbox/field-trip.email.card`, "true");

  // doctest:L85
  t.check(push.sent[0]?.payload.silent, false);

  // The intent line is in the log under the id the result returns, and open apps
  // got the live bus event with the same id and url:

  // doctest:L93
  const [n] = await readRecent(box.root, { days: 1, now: NOW });
  t.check([n?.intent.id === result.id, n?.intent.target, n?.intent.loudness, n?.intent.source], [
    true,
    "card:_content/inbox/field-trip.email.card",
    "loud",
    "notify-doctest",
  ]);

  // doctest:L97
  const bus = createEventBus(box.root);
  const events = bus.readSince(0).filter((e) => e.event === "notification").map((e) => eventSchemas.notification.parse(e.data));
  bus.close();
  t.check([events.length, events[0]?.id === result.id, events[0]?.url === push.sent[0]?.payload.url], [
    1,
    true,
    true,
  ]);

  // doctest:L103
  t.check(await failing(box), "all ok");
});

// ## `quiet` while someone is present: nothing sent
//
// An open app with a person active shows a `quiet` notification itself, so every
// channel is skipped as `present`. Presence is only current for 90 seconds: a
// stale presence file counts as nobody, and the next `quiet` sends.
void test("An open app with a person active shows a quiet notification itself, so every...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L118
  const box = await reachableBox();
  const push = createFakePush();
  await writePresence(box.root, { activeWeb: 1, now: new Date(NOW.getTime() - 30_000) });
  await notifyBoxholder(box.root, { intent: intent("quiet"), now: NOW, services: { push } });

  // doctest:L123
  await t.checkText(await logged(box), `apns skipped: present
web-push skipped: present`);

  // doctest:L128
  await t.checkText(push.sent.length, "0");

  // doctest:L131
  await writePresence(box.root, { activeWeb: 1, now: new Date(NOW.getTime() - 120_000) });
  await notifyBoxholder(box.root, { intent: intent("quiet"), now: NOW, services: { push } });
  await t.checkText(push.sent.length, "1");

  // A `quiet` push carries `silent`, which the service worker passes to
  // `showNotification`, so it makes no sound:

  // doctest:L141
  t.check(push.sent[0]?.payload.silent, true);

  // doctest:L144
  t.check(await failing(box), "all ok");
});

// ## `quiet` with no audience and nobody present: a visible gap
//
// Nothing can reach the person. Each channel is logged as `no-audience` and the
// health check names the notification.
void test("Nothing can reach the person.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L158
  const box = await makeTmpBox({ git: true });
  t.check(await notifyChannels(box.root), {
    apns: false,
    webPush: false,
  });

  // doctest:L162
  await notifyBoxholder(box.root, { intent: intent("quiet"), now: NOW });
  await t.checkText(await logged(box), `apns skipped: no-audience
web-push skipped: no-audience`);

  // doctest:L168
  t.check(await failing(box), "notifications-no-channel: 1 notification(s) in the last 24 hours had no channel to reach the boxholder (open the paired iPhone app or subscribe a browser to push): \"Field trip form due Friday\"");
});

// ## A channel counts as reachable only when a send could go out
//
// `notifyChannels` needs someone to send to and what the send needs: an
// injected service, or else VAPID keys for web push. A subscribed browser
// without VAPID keys is not a way to reach the person.
void test("notifyChannels needs someone to send to and what the send needs:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L183
  const box = await reachableBox();
  t.check(await notifyChannels(box.root), {
    apns: false,
    webPush: false,
  });

  // doctest:L187
  t.check(await notifyChannels(box.root, { services: { push: createFakePush() } }), {
    apns: false,
    webPush: true,
  });

  // doctest:L190
  process.env.BBX_VAPID_PUBLIC_KEY = "public";
  process.env.BBX_VAPID_PRIVATE_KEY = "private";
  const withKeys = await notifyChannels(box.root);
  delete process.env.BBX_VAPID_PUBLIC_KEY;
  delete process.env.BBX_VAPID_PRIVATE_KEY;
  t.check(withKeys.webPush, true);
});

// ## Generated ids start with a letter
//
// A URL search parser reads an all-digit value as a number, so an id is never
// one:
void test("A URL search parser reads an all-digit value as a number, so an id is never one:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L209
  const box = await reachableBox();
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) ids.push((await notifyBoxholder(box.root, { intent: intent("dot"), now: NOW })).id);
  await t.checkText(ids.every((id) => /^n[\w-]{8}$/.test(id)), "true");
});

// ## `channel` restricts delivery to one channel
//
// `bbx notify --channel` uses this to test one channel. The others are neither
// tried nor logged.
void test("bbx notify --channel uses this to test one channel.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L226
  const box = await reachableBox();
  const push = createFakePush();
  await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW, services: { push }, channel: "web-push" });

  // doctest:L230
  t.check(await logged(box), "web-push sent");

  // doctest:L233
  await t.checkText(push.sent.length, "1");
});

// ## A failing push: one `failed` line and a health check
//
// The push failure is recorded with its reason and reported for 24 hours.
void test("The push failure is recorded with its reason and reported for 24 hours.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L246
  const box = await reachableBox();
  const push = createFakePush({ failEndpoints: [SUB.endpoint] });
  await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW, services: { push } });

  // doctest:L250
  await t.checkText(await logged(box), `apns skipped: no-audience
web-push failed: no device received the push (sent 0, pruned 0, failed 1)`);

  // doctest:L255
  t.check(await failing(box), "notifications-undelivered: 1 notification(s) could not be delivered in the last 24 hours: \"Field trip form due Friday\" (web-push: no device received the push (sent 0, pruned 0, failed 1))");

  // A day later the failure has aged out of the check:

  // doctest:L262
  await t.checkText((await notificationHealthChecks(box.root, { now: new Date(NOW.getTime() + 25 * 60 * 60 * 1000) })).every((c) => c.ok), "true");
});

// ## An unwritable log does not stop delivery
//
// The log is the record, not the delivery path. When it cannot be appended to,
// the notification still sends and the writability check, which probes by
// opening for append rather than by reading, reports it.
void test("The log is the record, not the delivery path.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await fs.rm(storeDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L277
  const box = await reachableBox();
  await fs.mkdir(notificationLogPath(box.root), { recursive: true });
  const result = await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW, services: { push: createFakePush() } });

  // doctest:L281
  t.check(result.deliveries.map((d) => `${d.channel} ${d.status}`).join(", "), "apns skipped, web-push sent");

  // doctest:L284
  t.check((await notificationHealthChecks(box.root, { now: NOW })).find((c) => c.name === "notification-log-writable")?.ok, false);
});
