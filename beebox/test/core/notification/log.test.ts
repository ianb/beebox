// # The notification log
//
// `.beebox/notifications.jsonl` records every intent and every delivery, one
// JSON line each, append-only and gitignored. `readRecent` and `getIntent`
// group the deliveries under their intent. Rotation renames the file; readers
// read the current file and the rotated one.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import type { NotificationIntent } from "../../../src/core/notification/intent.js";
import {
  appendIntent,
  appendDelivery,
  readRecent,
  getIntent,
  rotateIfNeeded,
  notificationLogPath,
} from "../../../src/core/notification/log.js";
import type { LoggedNotification } from "../../../src/core/notification/log.js";
import { invariant } from "../../../src/shared/invariant.js";

const NOW = new Date("2026-09-26T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function intent(id: string, title: string): NotificationIntent {
  return { id, title, body: "", target: { kind: "dashboard" }, loudness: "loud", source: "log-doctest" };
}

function summary(n: LoggedNotification | null) {
  invariant(n, "the notification is in the log");
  const deliveries = n.deliveries.map((d) => `${d.channel}=${d.status}${d.detail ? `(${d.detail})` : ""}`);
  return `${n.intent.id} ${n.intent.title}: ${deliveries.length === 0 ? "(no deliveries)" : deliveries.join(" ")}`;
}

// ## Append, then read back grouped
//
// Each append is one line. The intent line carries the target in its string
// form.
void test("Each append is one line.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L44
  const box = await makeTmpBox();
  appendIntent(box.root, { intent: { ...intent("a1", "Vet at 3"), target: { kind: "chat-new" }, tag: "vet" }, now: NOW });
  appendDelivery(box.root, { notificationId: "a1", delivery: { channel: "web-push", status: "sent" }, now: NOW });
  appendDelivery(box.root, { notificationId: "a1", delivery: { channel: "apns", status: "failed", detail: "BadDeviceToken" }, now: NOW });
  appendIntent(box.root, { intent: intent("b2", "Two questions"), now: NOW });
  appendDelivery(box.root, { notificationId: "b2", delivery: { channel: "apns", status: "skipped", detail: "no-audience" }, now: NOW });

  // doctest:L51
  await t.checkText(fs.readFileSync(notificationLogPath(box.root), "utf-8").split("\n")[0], "{\"kind\":\"intent\",\"at\":\"2026-09-26T09:00:00.000Z\",\"id\":\"a1\",\"title\":\"Vet at 3\",\"body\":\"\",\"target\":\"chat:new\",\"loudness\":\"loud\",\"tag\":\"vet\",\"source\":\"log-doctest\"}");

  // doctest:L54
  await t.checkText((await readRecent(box.root, { days: 1, now: NOW })).map(summary).join("\n"), `a1 Vet at 3: web-push=sent apns=failed(BadDeviceToken)
b2 Two questions: apns=skipped(no-audience)`);

  // doctest:L59
  t.check(summary(await getIntent(box.root, "b2")), "b2 Two questions: apns=skipped(no-audience)");

  // doctest:L62
  t.check(await getIntent(box.root, "zz"), null);

  // `readRecent` keeps only intents inside the window:

  // doctest:L69
  await t.checkText((await readRecent(box.root, { days: 1, now: new Date(NOW.getTime() + 2 * DAY) })).length, "0");

  // An unparseable line (a crash mid-write, a hand edit) is skipped with a
  // warning; the lines around it still read:

  // doctest:L77
  fs.appendFileSync(notificationLogPath(box.root), "{not json\n");
  appendIntent(box.root, { intent: intent("c3", "After the bad line"), now: NOW });
  t.check((await readRecent(box.root, { days: 1, now: NOW })).map((n) => n.intent.id).join(" "), "a1 b2 c3");
});

// ## A delivery on a retired channel is read, not skipped
//
// Telegram was a channel until it was removed. A box's log can still hold
// `telegram` delivery lines, and the read schema accepts them: the line is
// grouped under its intent and no warning is printed.
void test("Telegram was a channel until it was removed.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L94
  const box = await makeTmpBox();
  appendIntent(box.root, { intent: intent("t1", "Sent before removal"), now: NOW });
  fs.appendFileSync(notificationLogPath(box.root), JSON.stringify({ kind: "delivery", at: NOW.toISOString(), notificationId: "t1", channel: "telegram", status: "sent" }) + "\n");
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  const read = (await readRecent(box.root, { days: 1, now: NOW })).map(summary).join("\n");
  console.warn = origWarn;
  await t.checkText([read, warnings.length].join("\n"), `t1 Sent before removal: telegram=sent
0`);
});

// ## A long body is shortened so the line stays one atomic write
//
// Appends under 4 KB are atomic on the filesystems in use, so the logged body is
// cut to fit. The delivered notification is not affected.
void test("Appends under 4 KB are atomic on the filesystems in use, so the logged body i...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L118
  const box = await makeTmpBox();
  appendIntent(box.root, { intent: { ...intent("long", "Long"), body: "x".repeat(20_000) }, now: NOW });
  const line = fs.readFileSync(notificationLogPath(box.root), "utf-8");
  t.check([Buffer.byteLength(line) < 4000, JSON.parse(line).body.endsWith("…")], [
    true,
    true,
  ]);
});

// ## The other fields are bounded, and a line that cannot fit is refused
//
// The tag and the source are cut to 200 characters. A line that is still over
// 4 KB with its body emptied is refused with an error rather than appended, so
// the log never holds a torn line.
void test("The tag and the source are cut to 200 characters.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L136
  const box = await makeTmpBox();
  appendIntent(box.root, { intent: { ...intent("tagged", "Tagged"), tag: "t".repeat(5000), source: "s".repeat(5000) }, now: NOW });
  const logged = JSON.parse(fs.readFileSync(notificationLogPath(box.root), "utf-8"));
  t.check([logged.tag.length, logged.tag.endsWith("…"), logged.source.length], [
    200,
    true,
    200,
  ]);

  // doctest:L142
  await t.checkThrows(async () => (appendIntent(box.root, { intent: { ...intent("x".repeat(5000), "Huge id"), body: "b".repeat(100) }, now: NOW })), "NotificationLogLineTooLongError");

  // doctest:L145
  await t.checkText(fs.readFileSync(notificationLogPath(box.root), "utf-8").split("\n").filter(Boolean).length, "1");
});

// ## Rotation
//
// The log rotates when its first line is older than 30 days, or when it
// exceeds 8 MB. A young, small log is left alone.
void test("The log rotates when its first line is older than 30 days, or when it exceeds...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L159
  const box = await makeTmpBox();
  const OLD = new Date(NOW.getTime() - 31 * DAY);
  appendIntent(box.root, { intent: intent("old", "From last month"), now: OLD });

  // doctest:L163
  t.check(await rotateIfNeeded(box.root, { now: new Date(OLD.getTime() + DAY) }), false);

  // doctest:L166
  t.check(await rotateIfNeeded(box.root, { now: NOW }), true);

  // doctest:L169
  t.check(fs.readdirSync(path.join(box.root, ".beebox")).filter((f) => f.startsWith("notifications")).toSorted().join(" "), "notifications.1.jsonl");

  // A writer that opened the file before the rename still holds the old
  // descriptor, so its line lands in the rotated file. Readers read both files,
  // so nothing is lost, and new appends start a fresh file:

  // doctest:L178
  appendIntent(box.root, { intent: intent("new", "Fresh file"), now: NOW });
  const staleFd = fs.openSync(notificationLogPath(box.root), "a");
  await rotateIfNeeded(box.root, { now: new Date(NOW.getTime() + 31 * DAY) });
  fs.writeSync(staleFd, JSON.stringify({ kind: "delivery", at: NOW.toISOString(), notificationId: "new", channel: "web-push", status: "sent" }) + "\n");
  fs.closeSync(staleFd);
  appendIntent(box.root, { intent: intent("later", "After rotation"), now: NOW });

  // doctest:L185
  await t.checkText((await readRecent(box.root, { days: 1, now: NOW })).map(summary).join("\n"), `new Fresh file: web-push=sent
later After rotation: (no deliveries)`);

  // The second rotation replaced the first rotated file, so the month-old
  // intent is gone. A file over 8 MB rotates whatever its age:

  // doctest:L195
  t.check(await getIntent(box.root, "old"), null);

  // doctest:L198
  fs.truncateSync(notificationLogPath(box.root), 8 * 1024 * 1024 + 1);
  t.check(await rotateIfNeeded(box.root, { now: NOW }), true);
});
