// # The walker's phone
//
// A wait lives through an interval of simulated time: every scheduled occurrence
// runs in time order, through fake channels, and then the box's clock moves to the
// end. The phone shows each notification that reached the person once, as text.
// See docs/plans/walk-simulated-time.md (Track 7).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { LoggedNotification } from "../../src/core/notification/log.ts";
import { makeTmpBox } from "../helpers/test-helpers.ts";
import { firedFor, formatPhoneEntry, occurrenceKey, parseWait, planWait, type ScheduleCard } from "./journeys/phone-core.ts";

// Cron occurrences are in the process's zone, as the scheduler's are; the test pins it.
process.env.TZ = "UTC";

const card = (name: string, fields: Partial<ScheduleCard>): ScheduleCard =>
  ({ name, kind: "notify", enabled: true, at: undefined, cron: undefined, rrule: undefined, until: undefined, ...fields });
const keys = (cards: ScheduleCard[], opts: { from: string; to: string }) => {
  const plan = planWait(cards, { from: new Date(opts.from), to: new Date(opts.to) });
  return { queue: plan.queue.map(occurrenceKey), refused: plan.refused };
};

// ## What a wait runs, and in what order
//
// Every occurrence in the wait, oldest first: a one-shot due by its end
// (including one already overdue: it still exists, so it has not run), each
// daily occurrence of a repeating card, a `runs:` card like a `notify:` one.
// A disabled card is skipped, and one past its `until` stops there.
void test("What a wait runs, and in what order", async (t) => {
  t.check(keys([
    card("later", { at: "2026-10-26T12:00:01Z" }),
    card("edge", { at: "2026-10-26T12:00:00Z" }),
    card("overdue", { at: "2026-10-20T09:00:00Z" }),
    card("daily", { cron: "0 9 * * *" }),
    card("review", { kind: "runs", cron: "30 6 * * *", until: "2026-10-25T00:00:00Z" }),
    card("weekly", { rrule: "FREQ=WEEKLY;BYDAY=MO;DTSTART=20261005T080000Z" }),
    card("off", { at: "2026-10-25T09:00:00Z", enabled: false }),
  ], { from: "2026-10-23T12:00:00Z", to: "2026-10-26T12:00:00Z" }), {
    queue: [
      "overdue@2026-10-20T09:00:00.000Z",
      "review@2026-10-24T06:30:00.000Z",
      "daily@2026-10-24T09:00:00.000Z",
      "daily@2026-10-25T09:00:00.000Z",
      "weekly@2026-10-26T08:00:00.000Z",
      "daily@2026-10-26T09:00:00.000Z",
      "edge@2026-10-26T12:00:00.000Z",
    ],
    refused: [],
  });
});

// ## A wait refuses a card that comes due too often
//
// A `runs:` card may run an agent each time, so a wait runs one at most eight
// times (a week of a daily card); a `notify:` card at most fifty. Over that,
// the wait refuses before running anything and names the card.
void test("A wait refuses a card that comes due too often", async (t) => {
  t.check(keys([
    card("hourly-run", { kind: "runs", cron: "0 * * * *" }),
    card("daily-run", { kind: "runs", cron: "0 6 * * *" }),
    card("quarter-hour", { cron: "*/15 * * * *" }),
  ], { from: "2026-10-23T12:00:00Z", to: "2026-10-30T12:00:00Z" }), {
    queue: [
      "daily-run@2026-10-24T06:00:00.000Z",
      "daily-run@2026-10-25T06:00:00.000Z",
      "daily-run@2026-10-26T06:00:00.000Z",
      "daily-run@2026-10-27T06:00:00.000Z",
      "daily-run@2026-10-28T06:00:00.000Z",
      "daily-run@2026-10-29T06:00:00.000Z",
      "daily-run@2026-10-30T06:00:00.000Z",
    ],
    refused: [
      "hourly-run (more than 8 times; wait less at once)",
      "quarter-hour (more than 50 times; wait less at once)",
    ],
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

const logged = (fields: { id: string; source: string; loudness: "dot" | "quiet" | "loud"; target: string; body: string; sent: boolean | "present" }): LoggedNotification => ({
  intent: { kind: "intent", at: "2026-10-26T12:48:49.000Z", id: fields.id, title: "Renew the home insurance", body: fields.body, target: fields.target, loudness: fields.loudness, source: fields.source },
  deliveries: [fields.sent === "present"
    ? { kind: "delivery", at: "2026-10-26T12:48:49.000Z", notificationId: fields.id, channel: "web-push", status: "skipped", detail: "present" }
    : { kind: "delivery", at: "2026-10-26T12:48:49.000Z", notificationId: fields.id, channel: "web-push", status: fields.sent ? "sent" : "failed", detail: "fake" }],
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
// tap opens without the box prefix (`bin/browse` adds it). One held back because
// the app was open is still listed: the app showed it as a banner.
void test("How a notification reads on the phone", async (t) => {
  const opts = { boxSlug: "g-paperwork-3", timeZone: "UTC" };
  t.check([
    formatPhoneEntry(logged({ id: "n1", source: "x", loudness: "loud", target: "chat:new", body: "Price goes up on Nov 7.", sent: true }), opts),
    formatPhoneEntry(logged({ id: "n2", source: "x", loudness: "dot", target: "card:_content/home/insurance.doc.card", body: " ", sent: true }), opts),
    formatPhoneEntry(logged({ id: "n3", source: "x", loudness: "quiet", target: "dashboard", body: "", sent: "present" }), opts),
  ], [
    "Mon, Oct 26, 12:48 PM — sound\nRenew the home insurance\nPrice goes up on Nov 7.\nTap opens: /chat?new=1&notification=n1",
    "Mon, Oct 26, 12:48 PM — badge only\nRenew the home insurance\nTap opens: /browse/_content/home/insurance.doc.card",
    "Mon, Oct 26, 12:48 PM — shown in the app, which was open; not sent to the phone\nRenew the home insurance\nTap opens: /",
  ]);
});

// ## A wait fires a reminder and the phone shows it once
//
// A real box and a real `bbx tick`: a reminder due in two days and a two-day wait,
// so it falls due at the wait's very end and must still arrive by then.
// The box is a walk fixture (`fakeNotifications`), so the wait can move its clock.
void test("A wait fires a reminder and the phone shows it once", async (t) => {
  const box = await makeTmpBox({ git: true });
  const runDir = mkdtempSync(join(tmpdir(), "bbx-phone-run-"));
  t.teardown(async () => {
    await box.cleanup();
    rmSync(runDir, { recursive: true, force: true });
  });
  const at = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/u, "Z");
  mkdirSync(join(box.root, "_config", "schedules"), { recursive: true });
  writeFileSync(join(box.root, "_config", "box.json"), JSON.stringify({ fakeNotifications: true }));
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
  const waited = phone("--wait", "2d");
  const again = phone();
  t.check({
    waited: normalize(waited),
    again: normalize(again),
    cardLeft: existsSync(join(box.root, "_config", "schedules", "remind-renew-abc123.scheduled-script.card")),
    state: normalize(readFileSync(join(runDir, "phone.json"), "utf8")).replace(/"[\w-]{6,}"/gu, '"<id>"').replace(/"now": "[^"]+"/u, '"now": "<walk clock>"'),
  }, {
    waited: `Your phone, <clock>: 1 new\n\n${expectedWhen(at)}\nRenew the home insurance\nPrice goes up on Nov 7.\nTap opens: /chat?new=1&notification=<id>`,
    again: "Nothing new on your phone (it is <clock>).",
    cardLeft: false,
    state: '{\n  "shown": [\n    "<id>"\n  ]\n}',
  });
});

function expectedWhen(at: string): string {
  const when = new Date(new Date(at).getTime() + 1000).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC",
  });
  return `${when} — sound`;
}
