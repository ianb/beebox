// # Connector config mutations: calendar / gmail, and Drive's absent one
//
// Two config-write mutations that persist a connector's JSON config and commit it:
// `calendar.updateConfig` and `admin.updateGmailConfig`. Each writes the file,
// commits exactly that path via `stageAndCommitPaths`, and returns the saved
// shape. Gmail is an `ownerProcedure`; calendar is public.
//
// Drive has no such mutation, on purpose — a Drive mount is a card, so there is no
// config for a settings page to write. The Drive section here pins that; the
// mount-writing procedures that DO exist are covered in
// `test/webapp/trpc/routers/drive.mounts.test.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../../src/webapp/trpc/context.js";
import type { TmpBox } from "../../helpers/test-helpers.js";
import { trpcContext } from "../../helpers/trpc-context.js";
import { appRouter } from "../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import assert from "node:assert/strict";
import { getLog } from "../../../src/lib/git/core/operations.js";
import { errorMessage } from "../../../src/shared/error-guards.js";
import { simpleGit } from "simple-git";

function caller(boxRoot: string) {
  const ctx: TrpcContext = trpcContext({ boxRoot, actor: "none" });
  return appRouter.createCaller(ctx);
}

async function lastCommit(boxRoot: string) {
  const [latest] = await getLog(boxRoot, 1);
  assert.ok(latest, "box has a commit");
  return latest;
}

async function readJson(box: TmpBox, rel: string) {
  return JSON.parse(await box.read(rel));
}

async function code(p: Promise<unknown>) {
  return p.then(() => "none", (e: unknown) => (e instanceof TRPCError ? e.code : String(e)));
}

// ## calendar.updateConfig writes the sync config and commits it
//
// Only the provided keys change (an omitted field keeps what was stored, here
// nothing), and the commit is scoped to the calendar config file — an unrelated
// dirty file is left uncommitted, proving the `stageAndCommitPaths` scoping the
// other config mutations share.
void test("Only the provided keys change (an omitted field keeps what was stored), and the...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  // A decoy the mutation must NOT sweep into its commit.
  await box.write("_content/decoy.md", "unrelated\n");
  const res = await caller(box.root).calendar.updateConfig({
    calendars: ["primary", "work@example.com"],
    syncDaysBack: 7,
  });
  t.check(res, {
    success: true,
  });

  const cfg = await readJson(box, "_config/connectors/google-calendar.json");
  t.check(cfg, {
    calendars: [
      "primary",
      "work@example.com",
    ],
    syncDaysBack: 7,
  });

  t.check((await lastCommit(box.root)).subject, "Update calendar sync config");

  // Commit scoped to just the config file; the decoy stayed uncommitted.
  const files = (await simpleGit(box.root).raw(["show", "--name-only", "--relative", "--format=", "HEAD"])).trim();
  t.check(files, "_config/connectors/google-calendar.json");

  // `status` porcelain paths are repo-root-relative; under the one-root layout
  // that's the same box root the decoy was written into.
  t.check((await simpleGit(box.root).status()).not_added, ["_content/decoy.md"]);

  // The calendar names and roles the sync caches in the same file survive a
  // settings save; the calendar-folders migration and `bbx calendar calendars`
  // read them.
  await box.write("_config/connectors/google-calendar.json", JSON.stringify({
    calendars: ["primary"], calendarNames: { primary: "Family" }, calendarRoles: { primary: "owner" },
  }));
  await caller(box.root).calendar.updateConfig({ calendars: ["primary", "school@example.com"] });
  t.check(await readJson(box, "_config/connectors/google-calendar.json"), {
    calendars: ["primary", "school@example.com"],
    calendarNames: { primary: "Family" },
    calendarRoles: { primary: "owner" },
  });
});

// ## drive has a config reader and no config writer
//
// A Drive mount is a `.gdoc.card` / `.gsheet.card` / `.gfolder.card` /
// `.glink.card` — the card's existence is the configuration. `drive.config` still
// reads the connector file, because a box set up before folder mounts were cards
// carries a legacy `folders` array there until its next sync converts it; but
// there is nothing to write, so `drive.updateConfig` does not exist.
void test("A Drive mount is a .gdoc.card / .gsheet.card / .gfolder.card / .glink.card —...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const c = caller(box.root);

  await box.write(
    "_config/connectors/google-drive.json",
    JSON.stringify({ folders: [{ driveFolderId: "abc", localPath: "sheets/x" }] }),
  );
  t.check(await c.drive.config(), {
    folders: [
      {
        driveFolderId: "abc",
        localPath: "sheets/x",
      },
    ],
  });

  // A config file that exists but does not parse is an error, never an empty
  // config — reading it as "no folder mounts" would silently drop the mounts still
  // owed a conversion.

  await box.write("_config/connectors/google-drive.json", "{oops");
  t.check(await code(c.drive.config()), "INTERNAL_SERVER_ERROR");

  // The router writes mounts — as cards, through the same operations `bbx drive
  // mount` / `link` / `unmount` use — but it never writes connector config.
  // `drive.add`, `drive.inspect`, and `drive.list` are the same delegation for
  // `bbx drive add` / `inspect` / `list`, letting an agent bearer reach those verbs
  // without shell access to the box.

  t.check(Object.keys(appRouter._def.procedures).filter((name) => name.startsWith("drive.")).toSorted(), [
    "drive.add",
    "drive.config",
    "drive.inspect",
    "drive.link",
    "drive.list",
    "drive.mount",
    "drive.mounts",
    "drive.syncFolder",
    "drive.unmount",
  ]);
});

// ## admin.updateGmailConfig trims and drops empties, committing the result
//
// The query is trimmed and blank labels are filtered out. The action is persisted
// alongside them — the form cannot save a filter without saying what happens to a
// match, so the connector never infers `track`.
//
// `query` and `labels` are two spellings of one shorthand, so a non-empty query
// wins and the labels are dropped rather than written into a file where they would
// look effective while matching nothing.
void test("The query is trimmed and blank labels are filtered out.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const c = caller(box.root);

  const res = await c.admin.updateGmailConfig({
    query: "  is:unread  ",
    labels: ["INBOX", "  ", "Work"],
    action: { type: "track" },
  });
  t.check(res, {
    query: "is:unread",
    labels: [],
    action: {
      type: "track",
    },
  });

  t.check(await readJson(box, "_config/connectors/gmail.json"), {
    query: "is:unread",
    action: {
      type: "track",
    },
  });

  t.check((await lastCommit(box.root)).subject, "Update Gmail filter config");

  // Labels alone are written as labels.

  const byLabel = await c.admin.updateGmailConfig({
    query: "",
    labels: ["INBOX", "  ", "Work"],
    action: { type: "track" },
  });
  t.check(byLabel, {
    query: "",
    labels: ["INBOX", "Work"],
    action: { type: "track" },
  });

  t.check(await readJson(box, "_config/connectors/gmail.json"), {
    labels: [
      "INBOX",
      "Work",
    ],
    action: {
      type: "track",
    },
  });

  // A filter with something to match but no action is refused, so the form cannot
  // save a config the connector would then reject.

  let refused = "";
  try {
    await c.admin.updateGmailConfig({ query: "is:unread", labels: [] });
  } catch (error) {
    refused = errorMessage(error);
  };
  t.check(
    refused,
    'Invalid _config/connectors/gmail.json: query or labels needs an action — add "action": {"type": "track"} to create a card per matching thread, or "action": {"type": "procedure", "ref": "_config/procedures/<name>.procedure.card"} to run a procedure instead',
  );

  // A procedure action routes matches without creating any card.

  const routed = await c.admin.updateGmailConfig({
    query: "is:unread",
    labels: [],
    action: { type: "procedure", ref: "_config/procedures/review.procedure.card" },
  });
  t.check(routed, {
    query: "is:unread",
    labels: [],
    action: {
      type: "procedure",
      ref: "_config/procedures/review.procedure.card",
    },
  });

  // When nothing is left to match, the action is dropped too: an action with no
  // query or labels beside it is a config error the connector would reject.

  // All-blank input collapses to an empty config.
  const empty = await c.admin.updateGmailConfig({ query: "   ", labels: ["  "] });
  t.check(empty, {
    query: "",
    labels: [],
    action: null,
  });

  t.check(await readJson(box, "_config/connectors/gmail.json"), {});

  // Re-saving the identical empty config commits nothing new.
  const before = (await lastCommit(box.root)).hash;
  await c.admin.updateGmailConfig({ query: "", labels: [] });
  const after = (await lastCommit(box.root)).hash;
  t.check(after, before);
});
