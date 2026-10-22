// # A reminder with no device to send to is recorded once, not retried
//
// A boxholder-requested reminder is loud. On a box with no paired phone and no
// browser push subscription, every channel skips as `no-audience`: no channel
// was tried. Retrying cannot change that, so the run records one failure and
// the reminder is not due again. (A send that a channel tried and failed does
// retry: see test/core/schedule/run-action.reminder-retry.test.ts.)

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { runTick } from "../../../src/cli/commands/tick.js";
import { loadScriptState } from "../../../src/core/schedule/state.js";
import { readRecent } from "../../../src/core/notification/log.js";
import { writePresence } from "../../../src/core/notification/presence.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

delete process.env.BBX_NOTIFY_FAKE;
process.env.BBX_ENGINE_AVAILABILITY_FILE = "/nonexistent/engine-availability.json";

const REMINDER = `---
at: 2026-10-21T20:00
once: true
notify:
  title: Call back
  loudness: loud
---
`;

void test("a loud reminder with no audience fails once and is not sent again", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(async () => {
    delete process.env.BBX_TIME;
    await box.cleanup();
  });
  await box.write("_config/schedules/remind-call.scheduled-script.card", REMINDER);
  box.commitAll("add");
  // The first tick, then the times the 1, 2, 4 minute backoff would retry at.
  const times = ["2026-10-22T08:31:00Z", "2026-10-22T08:32:30Z", "2026-10-22T08:35:00Z", "2026-10-22T08:40:00Z"];
  const ran: string[] = [];
  for (const iso of times) {
    process.env.BBX_TIME = iso;
    // The web app is open: the live banner shows it, but no push channel has anyone to send to.
    await writePresence(box.root, { activeWeb: 1, now: new Date(iso) });
    ran.push((await runTick(box.root, { quiet: true })).scripts.map((x) => `${x.name} ${x.status}`).join(", "));
  }
  // Only the first tick sends, and the failed send is `error`. The later
  // ticks find it not due (`skipped`), at each time the backoff would retry.
  t.check(ran, ["remind-call error", "remind-call skipped", "remind-call skipped", "remind-call skipped"]);
  // One failure, final, with the reason the boxholder sees:
  const state = await loadScriptState(box.root, "remind-call");
  t.check(
    { result: state.lastResult, failures: state.consecutiveFailures, final: state.lastFailureFinal, error: state.lastError },
    {
      result: "failure",
      failures: 1,
      final: true,
      error: "Not delivered: apns skipped (no-audience), web-push skipped (no-audience)",
    },
  );
  // One notification intent logged, so one live banner:
  t.check((await readRecent(box.root, { days: 36500 })).map((x) => x.intent.title), ["Call back"]);
});
