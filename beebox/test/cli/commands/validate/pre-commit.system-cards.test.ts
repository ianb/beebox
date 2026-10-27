// # Candidate-state protection for canonical interface cards

import { test } from "tap";
import "@ianbicking/tap-check/tap";
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
  const box = await makeTmpBox({ git: true });
  await rm(box.path("_config/interface"), { recursive: true });
  await box.write(MANIFEST_PATH, "");
  await box.commitAll("legacy");
  t.check(await checkSystemCards(box.root), []);

  t.check(await checkStagedSystemCards(box.root), []);

  await box.write(SYSTEM_CARD_PATHS.dashboard, "---\ntitle: Custom dashboard\n---\nKeep my notes.\n");
  await box.commitAll("partial bootstrap");
  git(box, "rm", "--cached", SYSTEM_CARD_PATHS.dashboard);
  t.check(await checkStagedSystemCards(box.root), [
    "Required system card missing from proposed commit: _config/interface/dashboard.card. Restore it from Git.",
  ]);

  git(box, "restore", "--staged", SYSTEM_CARD_PATHS.dashboard);
  await rm(box.path(SYSTEM_CARD_PATHS.dashboard));
  t.check(await checkStagedSystemCards(box.root), []);

  git(box, "restore", SYSTEM_CARD_PATHS.dashboard);
  await seedSystemCards(box.root, REMAINING_SYSTEM_CARD_MIGRATION);
  t.check(await box.read(SYSTEM_CARD_PATHS.dashboard), "---\ntitle: Custom dashboard\n---\nKeep my notes.\n");

  await appendManifestEntry(box.root, completion);
  git(box, "add", MANIFEST_PATH);
  t.check(await checkStagedSystemCards(box.root), [
    "Required system card missing from proposed commit: _config/interface/settings.card. Restore it from Git.",
    "Required system card missing from proposed commit: _config/interface/browse.card. Restore it from Git.",
  ]);

  await box.commitAll("completed bootstrap");
  t.check(await checkStagedSystemCards(box.root), []);

  // An enrolled HEAD cannot opt out by rolling back its manifest. Moving a required
  // card is both a missing canonical path and a duplicate instrument error.

  await box.write(MANIFEST_PATH, "");
  git(box, "add", MANIFEST_PATH);
  git(box, "mv", SYSTEM_CARD_PATHS.settings, "_config/interface/Other.settings.card");
  t.check(await checkStagedSystemCards(box.root), [
    "Required system card missing from proposed commit: _config/interface/settings.card. Restore it from Git.",
    "The settings card at _config/interface/Other.settings.card must be at _config/interface/settings.card. Open or restore the canonical card; do not create another instance.",
  ]);

  git(box, "reset", "--hard", "HEAD");
  await box.write(SYSTEM_CARD_PATHS.browse, "---\ntype: doc\n---\n");
  git(box, "add", SYSTEM_CARD_PATHS.browse);
  t.check(await checkStagedSystemCards(box.root), [
    'Invalid required system card _config/interface/browse.card: _config/interface/browse.card: frontmatter type "doc" does not match filename type "browse"',
  ]);

  git(box, "reset", "--hard", "HEAD");
  await rm(box.path("_config/interface"), { recursive: true });
  git(box, "add", "-A");
  t.check(await checkStagedSystemCards(box.root), [
    "Required system card missing from proposed commit: _config/interface/dashboard.card. Restore it from Git.",
    "Required system card missing from proposed commit: _config/interface/settings.card. Restore it from Git.",
    "Required system card missing from proposed commit: _config/interface/browse.card. Restore it from Git.",
    "Required system card missing from proposed commit: _config/interface/questions.card. Restore it from Git.",
    "Required system card missing from proposed commit: _config/interface/landmarks.card. Restore it from Git.",
    "Required system card missing from proposed commit: _config/interface/history.card. Restore it from Git.",
    "Required system card missing from proposed commit: _config/interface/inventory.card. Restore it from Git.",
    "Required system card missing from proposed commit: _config/interface/admin.card. Restore it from Git.",
  ]);

  t.check(await checkSystemCards(box.root), [
    "Required system card missing from working tree: _config/interface/dashboard.card. Restore it from Git.",
    "Required system card missing from working tree: _config/interface/settings.card. Restore it from Git.",
    "Required system card missing from working tree: _config/interface/browse.card. Restore it from Git.",
  ]);

  await t.checkThrows(async () => (await appendManifestEntry(box.root, completion)), "SystemCardInvariantError");

  await t.checkThrows(async () => (await writeManifest(box.root, [completion])), "SystemCardInvariantError");

  await box.write(MANIFEST_PATH, "");
  await t.checkThrows(async () => (await markMigrationApplied({ boxRoot: box.root, name: SYSTEM_CARD_MIGRATION })), "SystemCardInvariantError");

  t.checkText(
    (await runPreCommitChecks(box.root)).report,
    `Required system card missing from proposed commit: _config/interface/dashboard.card. Restore it from Git.
Required system card missing from proposed commit: _config/interface/settings.card. Restore it from Git.
Required system card missing from proposed commit: _config/interface/browse.card. Restore it from Git.
Required system card missing from proposed commit: _config/interface/questions.card. Restore it from Git.
Required system card missing from proposed commit: _config/interface/landmarks.card. Restore it from Git.
Required system card missing from proposed commit: _config/interface/history.card. Restore it from Git.
Required system card missing from proposed commit: _config/interface/inventory.card. Restore it from Git.
Required system card missing from proposed commit: _config/interface/admin.card. Restore it from Git.`,
  );
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
  const trashBox = await makeTmpBox({ git: true });
  const stray = "_content/Old.browse.card";
  const discarded = "_bookkeeping/trash/Old.browse.card";
  await trashBox.write(stray, "---\ntitle: Old browser\n---\n");
  await trashBox.commitAll("stray copy before validation");
  t.check(await checkSystemCards(trashBox.root), [
    "The browse card at _content/Old.browse.card must be at _config/interface/browse.card. Open or restore the canonical card; do not create another instance.",
  ]);

  git(trashBox, "mv", stray, discarded);
  t.check(await checkSystemCards(trashBox.root), []);

  t.check(await checkStagedSystemCards(trashBox.root), []);

  await seedSystemCards(trashBox.root, REMAINING_SYSTEM_CARD_MIGRATION);
  await trashBox.commitAll("discard stray copy");
  git(trashBox, "mv", SYSTEM_CARD_PATHS.browse, "_bookkeeping/trash/browse.card");
  t.check(await checkSystemCards(trashBox.root), ["Required system card missing from working tree: _config/interface/browse.card. Restore it from Git."]);

  t.check(await checkStagedSystemCards(trashBox.root), ["Required system card missing from proposed commit: _config/interface/browse.card. Restore it from Git."]);

  git(trashBox, "restore", "--source=HEAD", "--staged", "--worktree", SYSTEM_CARD_PATHS.browse);
  t.check(await checkSystemCards(trashBox.root), []);

  t.check(await checkStagedSystemCards(trashBox.root), []);

  git(trashBox, "mv", SYSTEM_CARD_PATHS.admin, "_bookkeeping/trash/admin.card");
  t.check(await checkStagedSystemCards(trashBox.root), ["Required system card missing from proposed commit: _config/interface/admin.card. Restore it from Git."]);

  git(trashBox, "restore", "--source=HEAD", "--staged", "--worktree", SYSTEM_CARD_PATHS.admin);
});
