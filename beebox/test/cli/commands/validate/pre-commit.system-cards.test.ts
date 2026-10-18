// # Candidate-state protection for canonical interface cards

import { test } from "tap";
import "agent-doctest/tap";
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { makeTmpBox, type TmpBox } from "../../../helpers/test-helpers.js";
import { checkSystemCards, checkStagedSystemCards, seedSystemCards } from "../../../../src/core/system-cards.js";
import { SYSTEM_CARD_PATHS, SYSTEM_CARD_MIGRATION, REMAINING_SYSTEM_CARD_MIGRATION } from "../../../../src/shared/system-card-paths.js";
import { MANIFEST_PATH } from "../../../../src/core/migrations.js";
import { runPreCommitChecks } from "../../../../src/cli/commands/validate/pre-commit.js";
import { markMigrationApplied } from "../../../../src/cli/commands/migrate.js";
import { appendManifestEntry, writeManifest } from "../../../../src/core/migration-run.js";

function git(box: TmpBox, ...args: string[]) { return execFileSync("git", args, { cwd: box.root }).toString(); }
const completion = { name: SYSTEM_CARD_MIGRATION, "applied-at": "2026-09-09T00:00:00Z" };

// An old box may omit all anchors. Partial bootstrap does not permit deleting an
// anchor that already exists in HEAD. Index deletion cannot be hidden by an
// unstaged working copy; unstaged removal cannot invalidate a valid index.
void test("An old box may omit all anchors.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L22
  const box = await makeTmpBox({ git: true });
  await rm(box.path("_config/interface"), { recursive: true });
  await box.write(MANIFEST_PATH, "");
  await box.commitAll("legacy");
  t.check(await checkSystemCards(box.root), []);

  // doctest:L29
  t.check(await checkStagedSystemCards(box.root), []);

  // doctest:L32
  await box.write(SYSTEM_CARD_PATHS.dashboard, "---\ntitle: Custom dashboard\n---\nKeep my notes.\n");
  await box.commitAll("partial bootstrap");
  git(box, "rm", "--cached", SYSTEM_CARD_PATHS.dashboard);
  t.check((await checkStagedSystemCards(box.root))[0]?.includes("Required system card missing from proposed commit"), true);

  // doctest:L38
  git(box, "restore", "--staged", SYSTEM_CARD_PATHS.dashboard);
  await rm(box.path(SYSTEM_CARD_PATHS.dashboard));
  t.check(await checkStagedSystemCards(box.root), []);

  // doctest:L43
  git(box, "restore", SYSTEM_CARD_PATHS.dashboard);
  await seedSystemCards(box.root, REMAINING_SYSTEM_CARD_MIGRATION);
  await t.checkText((await box.read(SYSTEM_CARD_PATHS.dashboard)).includes("Keep my notes."), "true");

  // doctest:L48
  await appendManifestEntry(box.root, completion);
  git(box, "add", MANIFEST_PATH);
  await t.checkText((await checkStagedSystemCards(box.root)).length, "2");

  // doctest:L53
  await box.commitAll("completed bootstrap");
  t.check(await checkStagedSystemCards(box.root), []);

  // An enrolled HEAD cannot opt out by rolling back its manifest. Moving a required
  // card is both a missing canonical path and a duplicate instrument error.

  // doctest:L62
  await box.write(MANIFEST_PATH, "");
  git(box, "add", MANIFEST_PATH);
  git(box, "mv", SYSTEM_CARD_PATHS.settings, "_config/interface/Other.settings.card");
  const moved = await checkStagedSystemCards(box.root);
  await t.checkText(moved.some((message) => message.includes("Required system card missing")) && moved.some((message) => message.includes("must be at")), "true");

  // doctest:L69
  git(box, "reset", "--hard", "HEAD");
  await box.write(SYSTEM_CARD_PATHS.browse, "---\ntype: doc\n---\n");
  git(box, "add", SYSTEM_CARD_PATHS.browse);
  await t.checkText((await checkStagedSystemCards(box.root)).some((message) => message.includes("does not match filename type")), "true");

  // doctest:L75
  git(box, "reset", "--hard", "HEAD");
  await rm(box.path("_config/interface"), { recursive: true });
  git(box, "add", "-A");
  await t.checkText((await checkStagedSystemCards(box.root)).length === Object.keys(SYSTEM_CARD_PATHS).length - 1, "true");

  // doctest:L81
  await t.checkText((await checkSystemCards(box.root)).length, "3");

  // doctest:L84
  await t.checkThrows(async () => (await appendManifestEntry(box.root, completion)), "SystemCardInvariantError");

  // doctest:L87
  await t.checkThrows(async () => (await writeManifest(box.root, [completion])), "SystemCardInvariantError");

  // doctest:L90
  await box.write(MANIFEST_PATH, "");
  await t.checkThrows(async () => (await markMigrationApplied({ boxRoot: box.root, name: SYSTEM_CARD_MIGRATION })), "SystemCardInvariantError");

  // doctest:L94
  await t.checkText((await runPreCommitChecks(box.root, { colors: false })).report.includes("Required system card missing from proposed commit"), "true");
});

// Trash is not an active instrument. A stray copy can be discarded through the
// ordinary trash path, but a trashed canonical card cannot satisfy presence.
void test("Trash is not an active instrument.", async (t) => {
  t.teardown(async () => {
    try {
      await trashBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L107
  const trashBox = await makeTmpBox({ git: true });
  const stray = "_content/Old.browse.card";
  const discarded = "_bookkeeping/trash/Old.browse.card";
  await trashBox.write(stray, "---\ntitle: Old browser\n---\n");
  await trashBox.commitAll("stray copy before validation");
  await t.checkText((await checkSystemCards(trashBox.root)).some((message) => message.includes("must be at")), "true");

  // doctest:L115
  git(trashBox, "mv", stray, discarded);
  t.check(await checkSystemCards(trashBox.root), []);

  // doctest:L119
  t.check(await checkStagedSystemCards(trashBox.root), []);

  // doctest:L122
  await seedSystemCards(trashBox.root, REMAINING_SYSTEM_CARD_MIGRATION);
  await trashBox.commitAll("discard stray copy");
  git(trashBox, "mv", SYSTEM_CARD_PATHS.browse, "_bookkeeping/trash/browse.card");
  const missingWorking = await checkSystemCards(trashBox.root);
  await t.checkText(missingWorking.length === 1 && missingWorking[0]?.includes("Required system card missing"), "true");

  // doctest:L129
  const missingIndex = await checkStagedSystemCards(trashBox.root);
  await t.checkText(missingIndex.length === 1 && missingIndex[0]?.includes("Required system card missing"), "true");

  // doctest:L133
  git(trashBox, "restore", "--source=HEAD", "--staged", "--worktree", SYSTEM_CARD_PATHS.browse);
  t.check(await checkSystemCards(trashBox.root), []);

  // doctest:L137
  t.check(await checkStagedSystemCards(trashBox.root), []);

  // doctest:L140
  git(trashBox, "mv", SYSTEM_CARD_PATHS.admin, "_bookkeeping/trash/admin.card");
  const missingLaterIndex = await checkStagedSystemCards(trashBox.root);
  await t.checkText(missingLaterIndex.length === 1 && missingLaterIndex[0]?.includes(SYSTEM_CARD_PATHS.admin), "true");

  // doctest:L145
  git(trashBox, "restore", "--source=HEAD", "--staged", "--worktree", SYSTEM_CARD_PATHS.admin);
});
