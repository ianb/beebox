// # Connector quiet/failing episodes and the dashboard warning
//
// `updateConnectorEpisodes` runs from the scheduler daemon after each tick. It
// brings each connector's episode up to date (a connector that has gone quiet or
// keeps failing) and records a new episode once, for the scheduler log. The
// dashboard shows a warning until the condition clears or the owner dismisses
// it. A quiet episode sends nothing (docs/implemented-plans/notifications.md,
// Track E). A new failing episode sends one `quiet` notice: the connector has
// stopped doing what it was connected for (boxholder decision 2026-10-22,
// docs/implemented-plans/connector-failing-reaches-people.md). See
// `connectors/activity-verdict.ts` for the rule and
// `test/connector-activity.verdict.test.ts` for its cases.

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
import type { TmpBox } from "../../../helpers/test-helpers.js";

// Hermetic: no central Google grant; every notification channel is fake.
delete process.env.BBX_GOOGLE_TOKENS_FILE;
process.env.BBX_NOTIFY_FAKE = "1";

/** Each logged notification: loudness, title, target, and body. */
async function sent(box: TmpBox) {
  return (await readRecent(box.root, { days: 36500 }))
    .map(({ intent }) => ({ loudness: intent.loudness, title: intent.title, target: intent.target, body: intent.body }));
}

/** A working Google grant: a stored refresh token, never found dead. */
async function seedWorkingGrant(box: TmpBox) {
  await box.seed("_config/connectors/google.secret.json", JSON.stringify({ refreshToken: "token" }));
}

/** One failed sync of `name` on `day`. */
async function fail(boxRoot: string, { name, day }: { name: string; day: string }) {
  const result: SyncResult = { success: true, created: [], updated: [], error: "Request failed with status code 404" };
  await syncConnector({ name, inboxPaths: [], sync: async () => result }, { boxRoot, now: at(day) });
}

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

  // ## A failing episode notifies once
  //
  // The quiet episode above sent nothing. The failing one sends one `quiet`
  // notice. No grant is stored in this box, so it says to reconnect Google:

  const notice = {
    loudness: "quiet" as const,
    title: "Gmail has stopped syncing",
    target: "admin:google-services",
    body: `Gmail has failed every sync since 2026-09-19.
New items may not be arriving. The error is on the dashboard.
Reconnect Google in Admin, in the Google Services section.`,
  };
  t.check(await sent(box), [notice]);

  // A later failing day is the same episode and sends nothing more:

  const later = await runDays(box.root, { start: addDays(failing, 1), pattern: "E" });
  t.check(await updateConnectorEpisodes(box.root, { now: at(later) }), null);
  t.check(await sent(box), [notice]);
});

// ## A failure with a working grant does not say reconnect
//
// A connector can fail with Google access intact: a deleted message stalled
// Gmail for two weeks, and reconnecting changed nothing. Two connectors that
// begin failing on different days, found on one pass, share one notice, each
// with its own start day:
void test("A failure with a working grant does not say reconnect", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await seedBox();
  await seedWorkingGrant(box);
  await fail(box.root, { name: "gmail", day: "2026-10-08" });
  await fail(box.root, { name: "gmail", day: "2026-10-09" });
  await fail(box.root, { name: "gmail", day: "2026-10-10" });
  await fail(box.root, { name: "google-drive", day: "2026-10-09" });
  await fail(box.root, { name: "google-drive", day: "2026-10-10" });
  t.check(await updateConnectorEpisodes(box.root, { now: at("2026-10-10") }), {
    connectors: ["gmail", "google-drive"],
  });

  t.check(await sent(box), [
    {
      loudness: "quiet",
      title: "Gmail and Google Drive have stopped syncing",
      target: "dashboard",
      body: `Gmail has failed every sync since 2026-10-08.
Google Drive has failed every sync since 2026-10-09.
New items may not be arriving. The error is on the dashboard.`,
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
