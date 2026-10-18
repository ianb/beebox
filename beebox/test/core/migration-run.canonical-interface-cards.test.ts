// # Canonical interface cards and the migration manifest gate
//
// The three interface-card cohorts are named after migrations
// (`canonical-interface-cards`, `remaining-interface-cards`,
// `search-interface-card`). Those migrations are retired, so their entries run
// the shared no-op; `seedSystemCards` still installs each cohort for `bbx init`.
// The runner keeps one rule for these names: it refuses to record a cohort in the
// manifest while that cohort's cards are missing or invalid.

import { test } from "tap";
import "agent-doctest/tap";
import { containing, isoDate } from "agent-doctest/check";
import { initBox } from "../../src/core/box/structure/core.js";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { appendManifestEntry, writeManifest } from "../../src/core/migration-run.js";
import { readManifest } from "../../src/core/migration-manifest.js";
import { markMigrationApplied } from "../../src/cli/commands/migrate.js";
import { sweepMigrations } from "../../src/core/migration-sweep.js";
import { MIGRATIONS, MANIFEST_PATH } from "../../src/core/migrations.js";
import { SYSTEM_CARD_PATHS, SYSTEM_CARD_MIGRATION, REMAINING_SYSTEM_CARD_MIGRATION, SEARCH_SYSTEM_CARD_MIGRATION } from "../../src/shared/system-card-paths.js";
import { seedSystemCards, checkSystemCards } from "../../src/core/system-cards.js";

async function pendingManifest(box: TmpBox) {
  await box.write(MANIFEST_PATH, MIGRATIONS.filter((entry) => entry.name !== SYSTEM_CARD_MIGRATION && entry.name !== REMAINING_SYSTEM_CARD_MIGRATION).map((entry) => JSON.stringify({ name: entry.name, "applied-at": "2026-09-09T00:00:00Z" })).join("\n") + "\n");
}

// A partial bootstrap keeps notes and installs the rest. Seeding again is quiet
// and preserves content.
void test("A partial bootstrap keeps notes and installs the rest.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L31
  const box = await makeTmpBox({ git: true });
  await rm(box.path("_config/interface"), { recursive: true });
  await box.write(SYSTEM_CARD_PATHS.dashboard, "---\ntitle: My dashboard\n---\nPreserved rationale.\n");
  await seedSystemCards(box.root, SYSTEM_CARD_MIGRATION);
  await seedSystemCards(box.root, REMAINING_SYSTEM_CARD_MIGRATION);
  t.check(await checkSystemCards(box.root, REMAINING_SYSTEM_CARD_MIGRATION), []);

  // doctest:L39
  await seedSystemCards(box.root, SYSTEM_CARD_MIGRATION);
  t.check(await box.read(SYSTEM_CARD_PATHS.dashboard), "---\ntitle: My dashboard\n---\nPreserved rationale.\n");

  // With the cards in place, the sweep records both pending cohort names:

  // doctest:L47
  await pendingManifest(box);
  await box.commitAll("cards seeded, cohorts pending");
  t.check((await sweepMigrations({ boxRoot: box.root })).status, "applied");

  // doctest:L52
  t.check(await readManifest(box.root), containing([{ name: SYSTEM_CARD_MIGRATION, "applied-at": isoDate() }]));

  // doctest:L55
  t.check(await readManifest(box.root), containing([{ name: REMAINING_SYSTEM_CARD_MIGRATION, "applied-at": isoDate() }]));
});

// A noncanonical copy fails the manifest gate at commit time: the sweep reports
// `commit-failed`, does not record the cohort, and leaves the copy alone. Seeding
// refuses the same box.
void test("A noncanonical copy fails the manifest gate at commit time:", async (t) => {
  t.teardown(async () => {
    try {
      await conflict.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L68
  const conflict = await makeTmpBox({ git: true });
  await pendingManifest(conflict);
  await conflict.write("_content/Copy.dashboard.card", "---\ntitle: Wrong location\n---\n");
  await conflict.commitAll("conflict");
  t.check((await sweepMigrations({ boxRoot: conflict.root })).status, "commit-failed");

  // doctest:L75
  t.check((await readManifest(conflict.root))?.filter((entry) => entry.name === SYSTEM_CARD_MIGRATION), []);

  // doctest:L78
  t.check(await conflict.read("_content/Copy.dashboard.card"), "---\ntitle: Wrong location\n---\n");

  // doctest:L81
  await t.checkThrows(async () => (await seedSystemCards(conflict.root, SYSTEM_CARD_MIGRATION)), "SystemCardInvariantError");
});

// The first cohort stays frozen to its original three cards even after the shared
// table grows. Its manifest gate likewise accepts that exact postcondition without
// requiring any of the five later cards.
void test("The first cohort stays frozen to its original three cards even after the shar...", async (t) => {
  t.teardown(async () => {
    try {
      await oldOnly.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L94
  const oldOnly = await makeTmpBox({ git: true });
  await rm(oldOnly.path("_config/interface"), { recursive: true });
  await pendingManifest(oldOnly);
  await oldOnly.write("_content/Future.admin.card", "---\ntitle: Future conflict\n---\nOld cohort ignores later cards.\n");
  await seedSystemCards(oldOnly.root, SYSTEM_CARD_MIGRATION);
  t.check(Object.values(SYSTEM_CARD_PATHS).filter((path) => existsSync(oldOnly.path(path))), [
    "_config/interface/dashboard.card",
    "_config/interface/settings.card",
    "_config/interface/browse.card",
  ]);

  // doctest:L102
  t.check(await oldOnly.read("_content/Future.admin.card"), "---\ntitle: Future conflict\n---\nOld cohort ignores later cards.\n");

  // doctest:L105
  await appendManifestEntry(oldOnly.root, { name: SYSTEM_CARD_MIGRATION, "applied-at": "2026-09-10T00:00:00Z" });
  t.check(await readManifest(oldOnly.root), containing([{ name: SYSTEM_CARD_MIGRATION, "applied-at": "2026-09-10T00:00:00Z" }]));

  // doctest:L109
  await t.checkThrows(async () => (await appendManifestEntry(oldOnly.root, { name: REMAINING_SYSTEM_CARD_MIGRATION, "applied-at": "2026-09-10T00:00:00Z" })), "SystemCardInvariantError");

  // doctest:L112
  await t.checkThrows(
    async () => (await writeManifest(oldOnly.root, [
      { name: SYSTEM_CARD_MIGRATION, "applied-at": "2026-09-10T00:00:00Z" },
      { name: REMAINING_SYSTEM_CARD_MIGRATION, "applied-at": "2026-09-10T00:00:00Z" },
    ])),
    "SystemCardInvariantError",
  );

  // doctest:L118
  await writeManifest(oldOnly.root, [{ name: SYSTEM_CARD_MIGRATION, "applied-at": "2026-09-10T00:00:00Z" }]);
  await t.checkThrows(async () => (await markMigrationApplied({ boxRoot: oldOnly.root, name: REMAINING_SYSTEM_CARD_MIGRATION })), "SystemCardInvariantError");

  // doctest:L122
  await rm(oldOnly.path("_content/Future.admin.card"));
  await seedSystemCards(oldOnly.root, REMAINING_SYSTEM_CARD_MIGRATION);
  await seedSystemCards(oldOnly.root, SEARCH_SYSTEM_CARD_MIGRATION);
  t.check(Object.values(SYSTEM_CARD_PATHS).filter((path) => existsSync(oldOnly.path(path))), Object.values(SYSTEM_CARD_PATHS));
});

// The second cohort is missing-only for the five later cards. A conflicting card
// of a new type blocks seeding; after repair, a retry keeps authored notes and the
// cohort can be recorded.
void test("The second cohort is missing-only for the five later cards.", async (t) => {
  t.teardown(async () => {
    try {
      await remainingConflict.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L138
  const remainingConflict = await makeTmpBox({ git: true });
  await pendingManifest(remainingConflict);
  await seedSystemCards(remainingConflict.root, SYSTEM_CARD_MIGRATION);
  await remainingConflict.write("_content/Copy.admin.card", "---\ntitle: Wrong Admin\n---\nDo not overwrite.\n");
  await t.checkThrows(async () => (await seedSystemCards(remainingConflict.root, REMAINING_SYSTEM_CARD_MIGRATION)), "SystemCardInvariantError");

  // doctest:L145
  t.check(await remainingConflict.read("_content/Copy.admin.card"), "---\ntitle: Wrong Admin\n---\nDo not overwrite.\n");

  // doctest:L148
  await rm(remainingConflict.path("_content/Copy.admin.card"));
  await remainingConflict.write(SYSTEM_CARD_PATHS.history, "---\ntitle: My history\n---\nPreserved history notes.\n");
  await seedSystemCards(remainingConflict.root, REMAINING_SYSTEM_CARD_MIGRATION);
  t.check(await remainingConflict.read(SYSTEM_CARD_PATHS.history), "---\ntitle: My history\n---\nPreserved history notes.\n");

  // doctest:L154
  await appendManifestEntry(remainingConflict.root, { name: REMAINING_SYSTEM_CARD_MIGRATION, "applied-at": "2026-09-10T00:00:00Z" });
  t.check(await readManifest(remainingConflict.root), containing([{ name: REMAINING_SYSTEM_CARD_MIGRATION, "applied-at": "2026-09-10T00:00:00Z" }]));
});

// Fresh initialization verifies cards before marking its completion. A failed
// bootstrap does not mark the box initialized, and retry preserves authored notes.
void test("Fresh initialization verifies cards before marking its completion.", async (t) => {
  t.teardown(async () => {
    try {
      await fresh.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L167
  const fresh = await makeTmpBox();
  await rm(fresh.path(".beebox/box.json"));
  await rm(fresh.path(MANIFEST_PATH));
  await fresh.write(SYSTEM_CARD_PATHS.settings, "---\ntype: doc\n---\nKeep this conflict.\n");
  await t.checkThrows(async () => (await initBox(fresh.root)), "SystemCardInvariantError");

  // doctest:L174
  t.check(await readManifest(fresh.root), null);

  // doctest:L177
  await fresh.write(SYSTEM_CARD_PATHS.settings, "---\ntitle: Settings\n---\nRepaired notes.\n");
  await initBox(fresh.root);
  t.check(await readManifest(fresh.root), containing([{ name: SYSTEM_CARD_MIGRATION, "applied-at": isoDate() }]));

  // doctest:L182
  t.check(await readManifest(fresh.root), containing([{ name: REMAINING_SYSTEM_CARD_MIGRATION, "applied-at": isoDate() }]));

  // doctest:L185
  t.check(Object.values(SYSTEM_CARD_PATHS).filter((path) => existsSync(fresh.path(path))), Object.values(SYSTEM_CARD_PATHS));

  // doctest:L188
  t.check(await fresh.read(SYSTEM_CARD_PATHS.settings), "---\ntitle: Settings\n---\nRepaired notes.\n");
});
