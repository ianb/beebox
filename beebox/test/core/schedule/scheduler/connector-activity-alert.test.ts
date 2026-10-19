// # Connector quiet/failing episodes and the dashboard warning
//
// `updateConnectorEpisodes` runs from the scheduler daemon after each tick. It
// brings each connector's episode up to date (a connector that has gone quiet or
// keeps failing) and records a new episode once, for the scheduler log. The
// dashboard shows a warning until the condition clears or the owner dismisses
// it. Nothing is sent: health never notifies on its own
// (docs/implemented-plans/notifications.md, Track E). See `connectors/activity-verdict.ts` for the rule and
// `connector-activity-verdict.doctest.md` for its cases.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { readRecent } from "../../../../src/core/notification/log.js";
import { syncConnector, addDays, loadConnectorActivity } from "../../../../src/connector-activity/core.js";
import { updateConnectorEpisodes } from "../../../../src/core/schedule/scheduler/connector-activity-alert.js";
import { connectorActivityHealthChecks } from "../../../../src/webapp/trpc/routers/health/checks/connectors.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import type { SyncResult } from "../../../../src/connectors.js";
import { invariant } from "../../../../src/shared/invariant.js";

async function seedBox() {
  const box = await makeTmpBox({ git: true });
  await box.seed("_config/box.json", JSON.stringify({ timezone: "UTC" }));
  box.commitAll("seed");
  return box;
}

const FIRST_DAY = "2026-08-15";
const at = (day: string) => new Date(`${day}T15:00:00Z`);

/** One sync per day: `P` brings in a new thread, `Z` succeeds with nothing new, `E` fails. */
async function runDays(boxRoot: string, { start, pattern }: { start: string; pattern: string }) {
  let day = start;
  for (const char of pattern) {
    const result: SyncResult = char === "P" ? { success: true, created: [`_content/inbox/email/${day}.email-thread.card`], updated: [] }
      : char === "Z" ? { success: true, created: [], updated: ["_content/inbox/email/old.email-thread.card"] }
      : { success: true, created: [], updated: [], error: "invalid_grant" };
    await syncConnector({ name: "gmail", inboxPaths: [], sync: async () => result }, { boxRoot, now: at(day) });
    day = addDays(day, 1);
  }
  return addDays(day, -1);
}

function caller(boxRoot: string, isOwner: boolean) {
  return appRouter.createCaller(trpcContext({
    boxRoot,
    user: { email: "owner@example.com", name: "Owner" },
    isOwner,
    isAuthenticatedOwner: isOwner,
    actor: isOwner ? "user" : "none",
  }));
}

// ## A steady producer that goes quiet is one episode
//
// Thirty days of new mail, then three days of successful syncs that only refresh
// tracked threads:
void test("Thirty days of new mail, then three days of successful syncs that only refres...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await seedBox();
  const last = await runDays(box.root, { start: FIRST_DAY, pattern: "P".repeat(30) + "ZZ" });
  t.check(await updateConnectorEpisodes(box.root, { now: at(last) }), null);

  const day3 = await runDays(box.root, { start: addDays(last, 1), pattern: "Z" });
  t.check(await updateConnectorEpisodes(box.root, { now: at(day3) }), {
    connectors: [
      "gmail",
    ],
  });

  const [warning] = await connectorActivityHealthChecks(box.root, { now: at(day3) });
  t.check(warning, {
    name: "connector-activity:gmail",
    ok: false,
    message: "gmail has brought in nothing new on its last 3 days of syncing since 2026-09-14 (more than 2 days without something new is unusual for it). Syncs are still succeeding, so check whether a filter, permission or upstream change stopped it.",
    severity: "warning",
    actions: ["dismiss-connector-episode"],
  });

  t.check(await readRecent(box.root, { days: 1, now: at(day3) }), []);

  // The episode is stamped, so later ticks, including on later quiet days, record
  // nothing new:

  t.check(await updateConnectorEpisodes(box.root, { now: at(day3) }), null);

  const day4 = await runDays(box.root, { start: addDays(day3, 1), pattern: "Z" });
  t.check(await updateConnectorEpisodes(box.root, { now: at(day4) }), null);

  // ## The dashboard warns until the owner dismisses it

  const [check] = await connectorActivityHealthChecks(box.root, { now: at(day4) });
  invariant(check, "the quiet connector raises a warning");
  t.check(check, {
    name: "connector-activity:gmail",
    ok: false,
    message: "gmail has brought in nothing new on its last 4 days of syncing since 2026-09-14 (more than 2 days without something new is unusual for it). Syncs are still succeeding, so check whether a filter, permission or upstream change stopped it.",
    severity: "warning",
    actions: ["dismiss-connector-episode"],
  });

  t.check(await caller(box.root, false).health.dismissConnectorEpisode({ check: check.name }).then(() => "allowed", (e) => e.code), "FORBIDDEN");

  t.check(await caller(box.root, true).health.dismissConnectorEpisode({ check: check.name }), {
    success: true,
  });

  t.check(await connectorActivityHealthChecks(box.root, { now: at(day4) }), []);

  // Dismissing when nothing is open is an error, not a silent success:

  t.check(await caller(box.root, true).health.dismissConnectorEpisode({ check: "connector-activity:calendar" }).then(() => "allowed", (e) => e.code), "NOT_FOUND");

  // ## New items end the episode; the next one is new

  const recovered = await runDays(box.root, { start: addDays(day4, 1), pattern: "P" });
  t.check(await updateConnectorEpisodes(box.root, { now: at(recovered) }), null);

  t.check((await loadConnectorActivity(box.root)).connectors.gmail?.episode, null);

  const failing = await runDays(box.root, { start: addDays(recovered, 1), pattern: "EE" });
  t.check(await updateConnectorEpisodes(box.root, { now: at(failing) }), {
    connectors: [
      "gmail",
    ],
  });

  t.check(await connectorActivityHealthChecks(box.root, { now: at(failing) }), [
    {
      name: "connector-activity:gmail",
      ok: false,
      message: "gmail has failed every sync on its last 2 days of running, since 2026-09-19: invalid_grant",
      severity: "warning",
      actions: ["dismiss-connector-episode"],
    },
  ]);
});

// ## A damaged record is a warning, not a reset
void test("A damaged record is a warning, not a reset", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await seedBox();
  await box.seed("_bookkeeping/connectors/connector-activity.state.json", "{\"version\":2}");
  const [check] = await connectorActivityHealthChecks(box.root, { now: at(FIRST_DAY) });
  invariant(check, "a damaged record raises a warning");
  t.check(check, {
    name: "connector-activity",
    ok: false,
    message: str`Connector activity record at ${box.root}/_bookkeeping/connectors/connector-activity.state.json is invalid: ${any(String)}`,
    severity: "warning",
  });
});
