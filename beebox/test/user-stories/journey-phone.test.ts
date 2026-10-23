// # The walker's phone
//
// A wait fires each one-shot `notify:` reminder due by its end, at the reminder's
// own time, through fake channels; the phone shows each notification that reached
// the person once, as text. See docs/plans/journey-simulated-notifications.md.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { LoggedNotification } from "../../src/core/notification/log.ts";
import { makeTmpBox } from "../helpers/test-helpers.ts";
import { firedFor, formatPhoneEntry, parseWait, pendingReminders, type ReminderCard } from "./journeys/phone-core.ts";

const card = (name: string, fields: Partial<ReminderCard>): ReminderCard =>
  ({ name, notify: true, enabled: true, at: undefined, recurring: false, ...fields });

// ## Which reminders a wait fires
//
// Every one-shot due by the end of the wait, oldest first, including one already
// overdue (it still exists, so it has not fired). A repeating reminder is named,
// not fired; a disabled card, a `runs:` card, and one due later are left alone.
void test("Which reminders a wait fires", async (t) => {
  const to = new Date("2026-10-30T12:00:00Z");
  t.check(pendingReminders([
    card("later", { at: "2026-10-30T12:00:01Z" }),
    card("edge", { at: "2026-10-30T12:00:00Z" }),
    card("overdue", { at: "2026-10-20T09:00:00Z" }),
    card("weekly", { recurring: true }),
    card("off", { at: "2026-10-25T09:00:00Z", enabled: false }),
    card("digest", { at: "2026-10-25T09:00:00Z", notify: false }),
  ], to), {
    pending: [
      { name: "overdue", at: new Date("2026-10-20T09:00:00Z") },
      { name: "edge", at: new Date("2026-10-30T12:00:00Z") },
    ],
    notSimulated: ["weekly"],
  });
});

// ## How long a wait is
//
// A whole number of hours, days, or weeks, up to eight weeks.
void test("How long a wait is", async (t) => {
  t.check(["36h", "2d", "1w"].map(parseWait), [129_600_000, 172_800_000, 604_800_000]);
  t.check(["0d", "9w", "2 days", "1.5d"].map((w) => {
    try {
      return parseWait(w);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }), [
    "--wait must be more than 0 and at most 8w, not \"0d\"",
    "--wait must be more than 0 and at most 8w, not \"9w\"",
    "--wait takes a whole number and h, d or w (for example 2d or 1w), not \"2 days\"",
    "--wait takes a whole number and h, d or w (for example 2d or 1w), not \"1.5d\"",
  ]);
});

const logged = (fields: { id: string; source: string; loudness: "dot" | "quiet" | "loud"; target: string; body: string; sent: boolean }): LoggedNotification => ({
  intent: { kind: "intent", at: "2026-10-26T12:48:49.000Z", id: fields.id, title: "Renew the home insurance", body: fields.body, target: fields.target, loudness: fields.loudness, source: fields.source },
  deliveries: [{ kind: "delivery", at: "2026-10-26T12:48:49.000Z", notificationId: fields.id, channel: "web-push", status: fields.sent ? "sent" : "failed", detail: "fake" }],
});

// ## Which notification a tick sent
//
// The one from that schedule that was not there before and that a channel sent.
void test("Which notification a tick sent", async (t) => {
  const after = [
    logged({ id: "old", source: "schedule:remind-a", loudness: "loud", target: "chat:new", body: "", sent: true }),
    logged({ id: "failed", source: "schedule:remind-a", loudness: "loud", target: "chat:new", body: "", sent: false }),
    logged({ id: "other", source: "schedule:remind-b", loudness: "loud", target: "chat:new", body: "", sent: true }),
    logged({ id: "new", source: "schedule:remind-a", loudness: "loud", target: "chat:new", body: "", sent: true }),
  ];
  t.check(firedFor(after, { seen: new Set(["old"]), name: "remind-a" })?.intent.id, "new");
  t.check(firedFor(after, { seen: new Set(["old", "new"]), name: "remind-a" }), undefined);
});

// ## How a notification reads on the phone
//
// Time, how it announced itself, title, body when there is one, and the path a
// tap opens without the box prefix (`bin/browse` adds it).
void test("How a notification reads on the phone", async (t) => {
  const opts = { boxSlug: "g-paperwork-3", timeZone: "UTC" };
  t.check([
    formatPhoneEntry(logged({ id: "n1", source: "x", loudness: "loud", target: "chat:new", body: "Price goes up on Nov 7.", sent: true }), opts),
    formatPhoneEntry(logged({ id: "n2", source: "x", loudness: "dot", target: "card:_content/home/insurance.doc.card", body: " ", sent: true }), opts),
  ], [
    "Mon, Oct 26, 12:48 PM — sound\nRenew the home insurance\nPrice goes up on Nov 7.\nTap opens: /chat?new=1&notification=n1",
    "Mon, Oct 26, 12:48 PM — badge only\nRenew the home insurance\nTap opens: /browse/_content/home/insurance.doc.card",
  ]);
});

// ## A wait fires a reminder and the phone shows it once
//
// A real box and a real `bbx tick`: a reminder due in two days, a three-day wait.
// The tick runs with fake channels forced, so it needs no box setting.
void test("A wait fires a reminder and the phone shows it once", async (t) => {
  const box = await makeTmpBox({ git: true });
  const runDir = mkdtempSync(join(tmpdir(), "bbx-phone-run-"));
  t.teardown(async () => {
    await box.cleanup();
    rmSync(runDir, { recursive: true, force: true });
  });
  const at = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/u, "Z");
  mkdirSync(join(box.root, "_config", "schedules"), { recursive: true });
  writeFileSync(join(box.root, "_config", "schedules", "remind-renew-abc123.scheduled-script.card"),
    `---\nat: ${at}\nonce: true\nrequested-by: boxholder\nnotify:\n  title: Renew the home insurance\n  body: Price goes up on Nov 7.\n  target: chat:new\n---\n`);
  writeFileSync(join(runDir, "before.json"), JSON.stringify({ box: box.root, url: "http://localhost:3210/wt/g-paperwork-3/" }));
  const phone = (...args: string[]) => execFileSync(process.execPath, ["--import", "tsx", resolve(import.meta.dirname, "journeys/phone.ts"), runDir, ...args], {
    encoding: "utf8", env: { ...process.env, TZ: "UTC" }, timeout: 180_000,
  });

  // The walk clock line and the notification id vary; everything else is the
  // text the walker reads.
  const normalize = (text: string) => text
    .replace(/notification=[\w-]+/gu, "notification=<id>")
    .replace(/\w+day, \w+ \d+ at \d+:\d+ [AP]M/gu, "<clock>")
    .trim();
  const waited = phone("--wait", "3d");
  const again = phone();
  t.check({
    waited: normalize(waited),
    again: normalize(again),
    cardLeft: existsSync(join(box.root, "_config", "schedules", "remind-renew-abc123.scheduled-script.card")),
    state: normalize(readFileSync(join(runDir, "phone.json"), "utf8")).replace(/"[\w-]{6,}"/gu, '"<id>"').replace(/"now": "[^"]+"/u, '"now": "<walk clock>"'),
  }, {
    waited: `Your phone, <clock>: 1 new\n\n${expectedWhen(at)}\nRenew the home insurance\nPrice goes up on Nov 7.\nTap opens: /chat?new=1&notification=<id>`,
    again: "Nothing new on your phone (walk clock: <clock>).",
    cardLeft: false,
    state: '{\n  "now": "<walk clock>",\n  "shown": [\n    "<id>"\n  ]\n}',
  });
});

function expectedWhen(at: string): string {
  const when = new Date(new Date(at).getTime() + 1000).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC",
  });
  return `${when} — sound`;
}

