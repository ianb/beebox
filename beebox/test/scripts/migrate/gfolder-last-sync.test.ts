// # `gfolder-last-sync-2026-10`: the folder card's sync time moves to Drive state
//
// Folder cards made before the move carry `last-sync`. The migration deletes
// that one key, leaving every other line as it was, and seeds the Drive state
// with the time so the mount does not read "never synced" until its next
// pass. A later time already in the state wins.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { planGfolderLastSync } from "../../../src/scripts/migrate/gfolder-last-sync/plan.js";
import { runGfolderLastSync } from "../../../src/scripts/migrate/gfolder-last-sync/run.js";
import { commitDriveStateDelta, loadDriveState } from "../../../src/connectors/google-drive/state.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const OLD_CARD = `---
drive:
  id: folder-1
  link: https://drive.google.com/drive/folders/folder-1
title: "Recipes" # quoted by hand
last-sync: 2026-10-29T16:01:27.963Z
contains: soup and bread
---
`;

const MIGRATED_CARD = `---
drive:
  id: folder-1
  link: https://drive.google.com/drive/folders/folder-1
title: "Recipes" # quoted by hand
contains: soup and bread
---
`;

void test("Only the last-sync key leaves the card; comments, quoting, and other keys stay", async (t) => {
  t.check(planGfolderLastSync(OLD_CARD), {
    kind: "strip",
    text: MIGRATED_CARD,
    driveId: "folder-1",
    lastSync: "2026-10-29T16:01:27.963Z",
  });
  t.check(planGfolderLastSync(MIGRATED_CARD), { kind: "current" });
});

// A block that does not parse cannot be edited safely, so it is left for a
// person; one that does not mention the key is none of this migration's business.
void test("Unreadable frontmatter is a leftover only when it names last-sync", async (t) => {
  t.check(planGfolderLastSync("---\ntitle: [unclosed\nlast-sync: 2026-10-01T00:00:00.000Z\n---\n"), {
    kind: "leftover",
    reason: "frontmatter does not parse; delete the last-sync line by hand",
  });
  t.check(planGfolderLastSync("---\ntitle: [unclosed\n  last-sync: 2026-10-01T00:00:00.000Z\n---\n"), {
    kind: "leftover",
    reason: "frontmatter does not parse; delete the last-sync line by hand",
  });
  t.check(planGfolderLastSync("---\ntitle: [unclosed\n---\n"), { kind: "current" });
  t.check(planGfolderLastSync("---\nlast-sync: 2026-10-01T00:00:00.000Z\n---\n"), {
    kind: "leftover",
    reason: "last-sync or drive.id is not a plain string; delete the last-sync line by hand",
  });
});

void test("Apply moves the time into state, keeps a later state time, and a rerun has nothing to do", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write("_content/drive/recipes/Recipes.gfolder.card", OLD_CARD);
  await box.write(
    "_content/drive/notes/Notes.gfolder.card",
    OLD_CARD.replaceAll("folder-1", "folder-2").replace("Recipes", "Notes"),
  );
  // folder-2 synced after the deploy, before the migration ran.
  const snapshot = await loadDriveState(box.root);
  const working = structuredClone(snapshot);
  working.folders["folder-2"] = { lastSync: "2026-10-30T09:00:00.000Z" };
  await commitDriveStateDelta({ boxRoot: box.root, snapshot, working });

  const dry = await runGfolderLastSync({ boxRoot: box.root, mode: "plan" });
  const applied = await runGfolderLastSync({ boxRoot: box.root, mode: "apply" });
  const again = await runGfolderLastSync({ boxRoot: box.root, mode: "apply" });
  t.check({ dry, applied, again }, {
    dry: {
      code: 0,
      lines: [
        "would strip last-sync from _content/drive/notes/Notes.gfolder.card (dry run; pass --apply)",
        "would strip last-sync from _content/drive/recipes/Recipes.gfolder.card (dry run; pass --apply)",
      ],
    },
    applied: {
      code: 0,
      lines: [
        "gfolder-last-sync: moved last-sync out of _content/drive/notes/Notes.gfolder.card.",
        "gfolder-last-sync: moved last-sync out of _content/drive/recipes/Recipes.gfolder.card.",
      ],
    },
    again: { code: 0, lines: ["gfolder-last-sync: already current."] },
  });
  t.check(await box.read("_content/drive/recipes/Recipes.gfolder.card"), MIGRATED_CARD);
  t.check((await loadDriveState(box.root)).folders, {
    "folder-1": { lastSync: "2026-10-29T16:01:27.963Z" },
    "folder-2": { lastSync: "2026-10-30T09:00:00.000Z" },
  });
});

void test("A card the migration cannot plan exits 2 and is named last", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write("_content/drive/recipes/Recipes.gfolder.card", OLD_CARD);
  await box.write("_content/drive/odd/Odd.gfolder.card", "---\nlast-sync: 2026-10-01T00:00:00.000Z\n---\n");
  t.check(await runGfolderLastSync({ boxRoot: box.root, mode: "plan" }), {
    code: 2,
    lines: [
      "would strip last-sync from _content/drive/recipes/Recipes.gfolder.card (dry run; pass --apply)",
      "leftover: _content/drive/odd/Odd.gfolder.card: last-sync or drive.id is not a plain string; delete the last-sync line by hand",
    ],
  });
  t.check(await runGfolderLastSync({ boxRoot: box.root, mode: "apply" }), {
    code: 2,
    lines: [
      "gfolder-last-sync: moved last-sync out of _content/drive/recipes/Recipes.gfolder.card.",
      "leftover: _content/drive/odd/Odd.gfolder.card: last-sync or drive.id is not a plain string; delete the last-sync line by hand",
    ],
  });
  t.check(await runGfolderLastSync({ boxRoot: box.root, mode: "apply" }), {
    code: 2,
    lines: [
      "gfolder-last-sync: already current.",
      "leftover: _content/drive/odd/Odd.gfolder.card: last-sync or drive.id is not a plain string; delete the last-sync line by hand",
    ],
  });
});
