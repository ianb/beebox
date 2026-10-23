// # `notify:` schedules: a reminder the tick sends itself
//
// A scheduled-script card with `notify:` in place of `runs:` is a reminder: when
// it comes due, `bbx tick` sends the notification in process through
// `notifyBoxholder`, with no shell and no agent. State recording and `once`
// deletion are the same as for a command. See docs/implemented-plans/notifications.md
// (Track D).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, capture, isoDate } from "@ianbicking/tap-check/check";
import assert from "node:assert/strict";
import { runTick } from "../../../src/cli/commands/tick.js";
import { loadScriptState } from "../../../src/core/schedule/state.js";
import { readRecent } from "../../../src/core/notification/log.js";
import { makeTmpBox, type TmpBox } from "../../helpers/test-helpers.js";

// Hermetic: no engine-availability store, and every channel through its fake.
process.env.BBX_ENGINE_AVAILABILITY_FILE = "/nonexistent/engine-availability.json";
process.env.BBX_NOTIFY_FAKE = "1";

/** The schedule cards left in the box. */
async function scheduleCards(box: TmpBox) {
  return (await box.list("_config/schedules")).split("\n").filter((p) => p.endsWith(".card")).join("\n");
}

// ## An `at` reminder fires, records success, and deletes itself
//
// `requested-by: boxholder` makes the default loudness `loud`; the target
// defaults to `chat:new`; the `context` ref is the body's last line; the
// `source` is the card's path and the tag its name.
void test("requested-by:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write("_config/schedules/remind-vet.scheduled-script.card", `---
at: 2020-10-02T08:30
once: true
requested-by: boxholder
notify:
  title: Call the vet about Pepper's shots
  body: Ask about the booster.
  context: _content/pets/pepper-shots.todo.card
---
`);
  box.commitAll("add reminder");

  const result = await runTick(box.root, { quiet: true });
  t.check(result.scripts, [
    {
      name: "remind-vet",
      status: "ran",
      command: "notify: Call the vet about Pepper's shots",
      durationMs: any(Number).int(),
    },
  ]);

  const [sent] = await readRecent(box.root, { days: 36500 });
  assert.ok(sent);
  const id = capture(any(String));
  t.check(sent.intent, {
      kind: "intent",
      id,
      at: isoDate(),
      title: "Call the vet about Pepper's shots",
      body: `Ask about the booster.

Context: _content/pets/pepper-shots.todo.card`,
      target: "chat:new",
      loudness: "loud",
      tag: "remind-vet",
      source: "schedule:remind-vet",
    });
  t.check(sent.deliveries, [
      { kind: "delivery", notificationId: id.value, at: isoDate(), channel: "apns", status: "sent", detail: "fake" },
      { kind: "delivery", notificationId: id.value, at: isoDate(), channel: "web-push", status: "sent", detail: "fake" },
    ]);

  t.check((await loadScriptState(box.root, "remind-vet")).lastResult, "success");

  t.check(await scheduleCards(box), "");

  // The deletion is committed like any other one-shot's:

  await t.check(import("node:child_process").then(({ execSync }) => execSync("git log -1 --format=%s", { cwd: box.root }).toString().trim()), "Tick: remove one-shot remind-vet");
});

// ## Without `requested-by`, the default loudness is `quiet`
//
// A schedule the box set up for itself is quiet unless it says otherwise, and
// an explicit `target` is kept.
void test("A schedule the box set up for itself is quiet unless it says otherwise, and a...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write("_config/schedules/weekly-note.scheduled-script.card", `---
at: 2020-01-01T09:00
notify:
  title: Weekly review is ready
  target: dashboard
---
`);
  box.commitAll("add note");
  await runTick(box.root, { quiet: true });
  const [sent] = await readRecent(box.root, { days: 36500 });
  assert.ok(sent);
  const id = capture(any(String));
  t.check(sent.intent, { kind: "intent", id, at: isoDate(), title: "Weekly review is ready", body: "", target: "dashboard", loudness: "quiet", tag: "weekly-note", source: "schedule:weekly-note" });
  t.check(sent.deliveries, [
      { kind: "delivery", notificationId: id.value, at: isoDate(), channel: "apns", status: "sent", detail: "fake" },
      { kind: "delivery", notificationId: id.value, at: isoDate(), channel: "web-push", status: "sent", detail: "fake" },
    ]);

  t.check(await scheduleCards(box), "_config/schedules/weekly-note.scheduled-script.card");
});

// ## A reminder that reaches nobody is a failure, and the card stays
//
// With no fake mode and no channel configured, nothing can carry it. The run
// records `failure` with the deliveries in the error, like `bbx notify` exiting 1
// inside a `runs:` pipeline, and `once` does not delete the card.
void test("With no fake mode and no channel configured, nothing can carry it.", async (t) => {
  t.teardown(async () => {
    try {
      process.env.BBX_NOTIFY_FAKE = "1";
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  delete process.env.BBX_NOTIFY_FAKE;
  const box = await makeTmpBox({ git: true });
  await box.write("_config/schedules/remind-call.scheduled-script.card", `---
at: 2020-10-02T08:30
once: true
notify:
  title: Call back
---
`);
  box.commitAll("add reminder");
  const result = await runTick(box.root, { quiet: true });
  t.check(result, {
    ranCount: 0,
    skipCount: 0,
    errorCount: 1,
    inconclusiveCount: 0,
    scripts: [
      {
        name: "remind-call",
        status: "error",
        command: "notify: Call back",
        durationMs: any(Number).int(),
        error: "Not delivered: apns skipped (no-audience), web-push skipped (no-audience)",
      },
    ],
  });

  const state = await loadScriptState(box.root, "remind-call");
  t.check(state, {
    lastRun: isoDate(),
    lastResult: "failure",
    lastError: "Not delivered: apns skipped (no-audience), web-push skipped (no-audience)",
    lastDurationMs: any(Number).int(),
    lastSuccess: null,
    consecutiveFailures: 1,
    alertedAt: null,
    alertedFor: null,
    skipped: null,
    runCount: 1,
    lastCommit: null,
    carry: null,
    lastDeferReason: null,
    // No channel was tried, so a retry cannot reach anyone: the reminder is not retried.
    lastFailureFinal: true,
    recentRuns: [{ ts: isoDate(), durationMs: any(Number).int() }],
  });

  t.check(await scheduleCards(box), "_config/schedules/remind-call.scheduled-script.card");
});
