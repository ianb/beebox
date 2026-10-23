// # Promotion: a requested schedule that cannot run says so once
//
// Health never notifies on its own. The one exception is a schedule the
// boxholder asked for (`requested-by: boxholder`) that could not run: the first
// tick of the episode sends one `loud` notification and latches
// `alertedFor: skipped:<reason>`; later ticks in the same episode send nothing;
// a run clears the latch. See docs/implemented-plans/notifications.md (Track E) and
// `src/core/schedule/promotion.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate } from "@ianbicking/tap-check/check";
import { runTick } from "../../../src/cli/commands/tick.js";
import { loadScriptState } from "../../../src/core/schedule/state.js";
import { readRecent } from "../../../src/core/notification/log.js";
import { checkRequiredConnectors } from "../../../src/core/schedule/promotion.js";
import { parseScheduledScript } from "../../../src/schemas/scheduled-script/schema.js";
import { syncConnector } from "../../../src/connector-activity/core.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import type { TmpBox } from "../../helpers/test-helpers.js";
import { invariant } from "../../../src/shared/invariant.js";

// Hermetic: no engine-availability store, no Google grant, every channel fake.
process.env.BBX_ENGINE_AVAILABILITY_FILE = "/nonexistent/engine-availability.json";
delete process.env.BBX_GOOGLE_TOKENS_FILE;
process.env.BBX_NOTIFY_FAKE = "1";

function card({ requested, requires }: { requested: boolean; requires: boolean }) {
  return [
    "---",
    'cron: "0 * * * *"',
    "description: field trip watch",
    ...(requested ? ["requested-by: boxholder"] : []),
    ...(requires ? ["requires:", "  connectors: [gmail]"] : []),
    'runs: "true"',
    "---",
    "",
  ].join("\n");
}

/** Each logged notification: loudness, title, target, and body. */
async function sent(box: TmpBox) {
  return (await readRecent(box.root, { days: 36500 }))
    .map(({ intent }) => ({ loudness: intent.loudness, title: intent.title, target: intent.target, body: intent.body }));
}

const FIELD_TRIP_NOTICE = {
  loudness: "loud" as const,
  title: "Your field trip watch could not run",
  target: "admin:google-services",
  body: "It needs gmail. Google is not connected or its access expired; open Admin › Google Services.",
};

/** A forced tick of one card: the schedule gate is bypassed, the connector gate is not. */
async function tick(box: TmpBox, script: string) {
  return (await runTick(box.root, { quiet: true, force: true, script })).scripts[0]?.status;
}

// ## A missing Google connector promotes once, with the Admin section as target
void test("A missing Google connector promotes once, with the Admin section as target", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write("_config/schedules/watch.scheduled-script.card", card({ requested: true, requires: true }));
  box.commitAll("add schedule");

  t.check(await tick(box, "watch"), "skipped");

  t.check(await sent(box), [FIELD_TRIP_NOTICE]);

  const state = await loadScriptState(box.root, "watch");
  invariant(state.skipped, "skipped episode is recorded");
  t.check(state, {
    lastRun: null,
    lastResult: null,
    lastError: null,
    lastDurationMs: null,
    lastSuccess: null,
    consecutiveFailures: 0,
    alertedAt: isoDate(),
    alertedFor: "skipped:missing-connectors",
    skipped: { reason: "missing-connectors", since: isoDate() },
    runCount: 0,
    lastCommit: null,
    carry: null,
    lastDeferReason: null,
  });

  // Later ticks in the same episode keep its `since` and send nothing:

  await tick(box, "watch");
  t.check((await loadScriptState(box.root, "watch")).skipped, state.skipped);

  t.check(await sent(box), [FIELD_TRIP_NOTICE]);

  // A run clears both the episode and the latch, so the next episode promotes
  // again:

  await box.write("_config/schedules/watch.scheduled-script.card", card({ requested: true, requires: false }));
  t.check(await tick(box, "watch"), "ran");

  const cleared = await loadScriptState(box.root, "watch");
  t.check(cleared, {
    lastRun: isoDate(),
    lastResult: "success",
    lastError: null,
    lastDurationMs: any(Number).between(0, Infinity),
    lastSuccess: isoDate(),
    consecutiveFailures: 0,
    alertedAt: null,
    alertedFor: null,
    skipped: null,
    runCount: 1,
    lastCommit: any(String).matches(/^[\da-f]{40}$/),
    carry: null,
    lastDeferReason: null,
    recentRuns: [{ ts: isoDate(), durationMs: any(Number).between(0, Infinity) }],
  });

  await box.write("_config/schedules/watch.scheduled-script.card", card({ requested: true, requires: true }));
  await tick(box, "watch");
  t.check(await sent(box), [FIELD_TRIP_NOTICE, FIELD_TRIP_NOTICE]);
});

// ## A schedule the system set up never promotes
//
// The episode is still recorded; nothing is sent.
void test("The episode is still recorded; nothing is sent.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write("_config/schedules/sync.scheduled-script.card", card({ requested: false, requires: true }));
  box.commitAll("add schedule");

  t.check(await tick(box, "sync"), "skipped");

  t.check((await loadScriptState(box.root, "sync")).skipped, { reason: "missing-connectors", since: isoDate() });

  t.check(await sent(box), []);
});

// ## A run deferred for want of the Jev key promotes once
//
// The pipeline's defer marker says `unconfigured`. The latch survives the next
// run that defers the same way, so the second run sends nothing.
void test("The pipeline's defer marker says unconfigured.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write("_config/schedules/judge.scheduled-script.card", `---
cron: "0 * * * *"
requested-by: boxholder
runs: printf '{"reason":"unconfigured"}' > "$BBX_DEFER_FILE"; exit 75
---
`);
  box.commitAll("add schedule");

  await tick(box, "judge");
  await tick(box, "judge");
  t.check(await sent(box), [
    {
      loudness: "loud",
      title: "Your judge could not run",
      target: "dashboard",
      body: 'Its judgment step needs Jev, and the box has no OpenRouter key for Jev. Grant the "openrouter" secret to this box.',
    },
  ]);

  t.check((await loadScriptState(box.root, "judge")).alertedFor, "skipped:unconfigured");
});

// ## A required connector in a failing episode promotes once, though the card runs
//
// The card itself can run; the tick checks the connectors it requires just
// before running it. Two days of failed gmail syncs are a failing episode:
void test("The card itself can run; the tick checks the connectors it requires just befo...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.seed("_config/box.json", JSON.stringify({ timezone: "UTC" }));
  box.commitAll("seed");
  const fail = { name: "gmail", inboxPaths: [], sync: async () => ({ success: true, created: [], updated: [], error: "invalid_grant" }) };
  await syncConnector(fail, { boxRoot: box.root, now: new Date("2026-09-20T15:00:00Z") });
  await syncConnector(fail, { boxRoot: box.root, now: new Date("2026-09-21T15:00:00Z") });

  const parsed = parseScheduledScript({ type: "scheduled-script", cron: "0 * * * *", "requested-by": "boxholder", requires: { connectors: ["gmail"] }, runs: "true", enabled: true });
  const state = await loadScriptState(box.root, "watch");
  const ctx = { boxRoot: box.root, scriptName: "watch", parsed, state, now: new Date("2026-09-21T16:00:00Z") };
  await checkRequiredConnectors(ctx);
  await checkRequiredConnectors(ctx);
  t.check(await sent(box), [
    {
      loudness: "loud",
      title: "Your watch could not run",
      target: "admin:google-services",
      body: `It depends on gmail. gmail has failed every sync on its last 2 days of running, since 2026-09-20: invalid_grant
Reconnect Google in Admin, in the Google Services section.`,
    },
  ]);

  // When the episode ends, the latch clears so the next episode is new:

  const ok = { ...fail, sync: async () => ({ success: true, created: ["_content/inbox/email/a.email-thread.card"], updated: [] }) };
  await syncConnector(ok, { boxRoot: box.root, now: new Date("2026-09-22T15:00:00Z") });
  await checkRequiredConnectors({ ...ctx, now: new Date("2026-09-22T16:00:00Z") });
  t.check((await loadScriptState(box.root, "watch")).alertedFor, null);
});

// ## A requirement name finds its connector's episode; a working grant gets no reconnect hint
//
// A card requires `calendar` (the requirement name, `src/requirements.ts`); the
// activity record names the connector `google-calendar`. The grant is stored
// and not found dead, so the notice does not send the person to reconnect
// Google, which could not help:
void test("A requirement name finds its connector's episode; a working grant gets no reconnect hint", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.seed("_config/box.json", JSON.stringify({ timezone: "UTC" }));
  await box.seed("_config/connectors/google.secret.json", JSON.stringify({ refreshToken: "token" }));
  box.commitAll("seed");
  const fail = { name: "google-calendar", inboxPaths: [], sync: async () => ({ success: true, created: [], updated: [], error: "Request failed with status code 500" }) };
  await syncConnector(fail, { boxRoot: box.root, now: new Date("2026-09-20T15:00:00Z") });
  await syncConnector(fail, { boxRoot: box.root, now: new Date("2026-09-21T15:00:00Z") });

  const parsed = parseScheduledScript({ type: "scheduled-script", cron: "0 * * * *", "requested-by": "boxholder", requires: { connectors: ["calendar"] }, runs: "true", enabled: true });
  const state = await loadScriptState(box.root, "watch");
  await checkRequiredConnectors({ boxRoot: box.root, scriptName: "watch", parsed, state, now: new Date("2026-09-21T16:00:00Z") });
  t.check(await sent(box), [
    {
      loudness: "loud",
      title: "Your watch could not run",
      target: "dashboard",
      body: "It depends on google-calendar. google-calendar has failed every sync on its last 2 days of running, since 2026-09-20: Request failed with status code 500",
    },
  ]);
});
