// # notifyBoxholder: log, decide, deliver once
//
// `notifyBoxholder` is the one way the box reaches the person. It appends the
// intent to `.beebox/notifications.jsonl`, emits a live `notification` event for
// open apps, picks channels from the loudness, the audience, and presence, sends
// once on each in process, and appends one delivery line per channel. There is no
// queue and no retry: a failure is a `failed` line, and the notification health
// checks report it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { notificationReached, notifyBoxholder, notifyChannels, type NotificationInput } from "../../src/core/notify-boxholder.js";
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
    source: "notify-test",
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
  const box = await reachableBox();
  const push = createFakePush();
  const result = await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW, services: { push } });

  await t.checkText(await logged(box), `apns skipped: no-audience
web-push sent`);

  // The push carries the rendered deep link and makes a sound:

  const slug = await boxSlug(box.root);
  t.check(push.sent, [{
    endpoint: "https://push.example/phone",
    payload: {
      icon: `${slug}/icon-192.png`,
      title: "Field trip form due Friday",
      body: "The school emailed: the form is due Friday.",
      url: `/${slug}/browse/_content/inbox/field-trip.email.card`,
      tag: undefined,
      silent: false,
    },
  }]);

  // The intent line is in the log under the id the result returns, and open apps
  // got the live bus event with the same id and url:

  const [n] = await readRecent(box.root, { days: 1, now: NOW });
  t.check(n?.intent, {
    kind: "intent",
    at: "2026-09-26T12:00:00.000Z",
    id: result.id,
    title: "Field trip form due Friday",
    body: "The school emailed: the form is due Friday.",
    target: "card:_content/inbox/field-trip.email.card",
    loudness: "loud",
    source: "notify-test",
  });

  const bus = createEventBus(box.root);
  const events = bus.readSince(0).filter((e) => e.event === "notification").map((e) => eventSchemas.notification.parse(e.data));
  bus.close();
  t.check(events, [{
    id: result.id,
    title: "Field trip form due Friday",
    body: "The school emailed: the form is due Friday.",
    target: "card:_content/inbox/field-trip.email.card",
    loudness: "loud",
    source: "notify-test",
    url: `/${slug}/browse/_content/inbox/field-trip.email.card`,
  }]);

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
  const box = await reachableBox();
  const push = createFakePush();
  await writePresence(box.root, { activeWeb: 1, now: new Date(NOW.getTime() - 30_000) });
  await notifyBoxholder(box.root, { intent: intent("quiet"), now: NOW, services: { push } });

  await t.checkText(await logged(box), `apns skipped: present
web-push skipped: present`);

  t.check(push.sent, []);

  await writePresence(box.root, { activeWeb: 1, now: new Date(NOW.getTime() - 120_000) });
  await notifyBoxholder(box.root, { intent: intent("quiet"), now: NOW, services: { push } });
  const quietSlug = await boxSlug(box.root);
  t.check(push.sent, [{
    endpoint: "https://push.example/phone",
    payload: {
      icon: `${quietSlug}/icon-192.png`,
      title: "Field trip form due Friday",
      body: "The school emailed: the form is due Friday.",
      url: `/${quietSlug}/browse/_content/inbox/field-trip.email.card`,
      tag: undefined,
      silent: true,
    },
  }]);

  // A `quiet` push carries `silent`, which the service worker passes to
  // `showNotification`, so it makes no sound:

  t.check(push.sent[0]?.payload.silent, true);

  t.check(await failing(box), "all ok");
});

// ## `loud` with no audience while someone is present: the open app showed it
//
// A `loud` send tries every channel with an audience, so presence skips nothing
// and a box with no device has every channel `no-audience`. The live event
// still showed the banner, so the send reached the person (`shown`). A `dot`
// has no banner: it is not shown, and not reached.
void test("A loud send with no audience reached a person with the app open", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await writePresence(box.root, { activeWeb: 1, now: new Date(NOW.getTime() - 30_000) });
  const loud = await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW });
  const dot = await notifyBoxholder(box.root, { intent: intent("dot"), now: NOW });
  t.check(
    { loud: { shown: loud.shown, reached: notificationReached(loud), deliveries: loud.deliveries.map((d) => d.detail) }, dot: { shown: dot.shown, reached: notificationReached(dot) } },
    { loud: { shown: true, reached: true, deliveries: ["no-audience", "no-audience"] }, dot: { shown: false, reached: false } },
  );

  // `bbx notify --channel apns` tests that channel: the banner does not stand in for it.
  const only = await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW, channel: "apns" });
  t.check({ shown: only.shown, reached: notificationReached(only) }, { shown: false, reached: false });

  // Nobody present: the same `loud` send reached nobody.
  await writePresence(box.root, { activeWeb: 0, now: NOW });
  const alone = await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW });
  t.check({ shown: alone.shown, reached: notificationReached(alone) }, { shown: false, reached: false });
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
  const box = await makeTmpBox({ git: true });
  t.check(await notifyChannels(box.root), {
    apns: false,
    webPush: false,
  });

  await notifyBoxholder(box.root, { intent: intent("quiet"), now: NOW });
  await t.checkText(await logged(box), `apns skipped: no-audience
web-push skipped: no-audience`);

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
  const box = await reachableBox();
  t.check(await notifyChannels(box.root), {
    apns: false,
    webPush: false,
  });

  t.check(await notifyChannels(box.root, { services: { push: createFakePush() } }), {
    apns: false,
    webPush: true,
  });

  process.env.BBX_VAPID_PUBLIC_KEY = "public";
  process.env.BBX_VAPID_PRIVATE_KEY = "private";
  const withKeys = await notifyChannels(box.root);
  delete process.env.BBX_VAPID_PUBLIC_KEY;
  delete process.env.BBX_VAPID_PRIVATE_KEY;
  t.check(withKeys, { apns: false, webPush: true });
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
  const box = await reachableBox();
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) ids.push((await notifyBoxholder(box.root, { intent: intent("dot"), now: NOW })).id);
  t.check(ids, Array.from({ length: 5 }, () => any(String).matches(/^n[\w-]{8}$/)));
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
  const box = await reachableBox();
  const push = createFakePush();
  await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW, services: { push }, channel: "web-push" });

  t.check(await logged(box), "web-push sent");

  const channelSlug = await boxSlug(box.root);
  t.check(push.sent, [{
    endpoint: "https://push.example/phone",
    payload: {
      icon: `${channelSlug}/icon-192.png`,
      title: "Field trip form due Friday",
      body: "The school emailed: the form is due Friday.",
      url: `/${channelSlug}/browse/_content/inbox/field-trip.email.card`,
      tag: undefined,
      silent: false,
    },
  }]);
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
  const box = await reachableBox();
  const push = createFakePush({ failEndpoints: [SUB.endpoint] });
  await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW, services: { push } });

  await t.checkText(await logged(box), `apns skipped: no-audience
web-push failed: no device received the push (sent 0, pruned 0, failed 1)`);

  t.check(await failing(box), "notifications-undelivered: 1 notification(s) could not be delivered in the last 24 hours: \"Field trip form due Friday\" (web-push: no device received the push (sent 0, pruned 0, failed 1))");

  // A day later the failure has aged out of the check:

  t.check(await notificationHealthChecks(box.root, { now: new Date(NOW.getTime() + 25 * 60 * 60 * 1000) }), [
    { name: "notifications-undelivered", ok: true, message: "No notification failed to deliver in the last 24 hours", severity: "warning" },
    { name: "notifications-no-channel", ok: true, message: "Every notification in the last 24 hours had a channel to reach the boxholder", severity: "warning" },
    { name: "notification-log-writable", ok: true, message: "The notification log is writable", severity: "warning" },
    { name: "notifications-fake", ok: true, message: "Notifications on this box send for real", severity: "warning" },
    { name: "box-clock-offset", ok: true, message: "This box's clock is real time", severity: "warning" },
    { name: "jev-budget", ok: true, message: "No judgment deferred for the daily Jev budget in the last 24 hours", severity: "warning" },
  ]);
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
  const box = await reachableBox();
  await fs.mkdir(notificationLogPath(box.root), { recursive: true });
  const result = await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW, services: { push: createFakePush() } });

  t.check(result.deliveries.map((d) => `${d.channel} ${d.status}`), ["apns skipped", "web-push sent"]);

  t.check((await notificationHealthChecks(box.root, { now: NOW })).find((c) => c.name === "notification-log-writable"), {
    name: "notification-log-writable",
    ok: false,
    message: `The notification log is not writable (EISDIR: illegal operation on a directory, open '${notificationLogPath(box.root)}'); notifications still send but leave no record`,
    severity: "warning",
  });
});
