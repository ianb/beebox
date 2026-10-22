// # Orphan MAP.md files
//
// Tests for `src/core/maps/orphans.ts`. A MAP.md in a directory that no longer
// gets one — hidden by an ignore pattern, or no longer meeting the container
// and useful-content rules — is never refreshed, yet its instruction file keeps
// importing it into agent context. Pruning deletes the map, the import, and
// the state entry.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { findOrphanMaps, pruneOrphanMaps } from "../../../src/core/maps/orphans.js";
import { loadMapState, saveMapState } from "../../../src/core/maps/state.js";
import { getHead } from "../../../src/lib/git/core/operations.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import type { TmpBox } from "../../helpers/test-helpers.js";
import { lstat, symlink } from "node:fs/promises";
import { join } from "node:path";

async function exists(box: TmpBox, rel: string): Promise<boolean> {
  return lstat(join(box.root, rel)).then(() => true, () => false);
}

// ## Hidden and non-qualifying directories are orphans; mapped ones are not
//
// `_content/chat/**` is a skeleton-hidden path. `solo/` has one subdirectory
// and nothing else, so it fails the useful-content rule. `work/` qualifies. The
// box root is never reported: its AGENTS.md is a managed template.
void test("content/chat/ is a skeleton-hidden path.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write("_content/chat/MAP.md", "# Map: store/chat\n");
  await box.write("_content/chat/AGENTS.md", "@MAP.md\n");
  await box.write("solo/only/a.md", "a");
  await box.write("solo/MAP.md", "# Map: solo\n");
  await box.write("work/notes/a.md", "a");
  await box.write("work/refs/b.md", "b");
  await box.write("work/MAP.md", "# Map: work\n");
  await box.write("MAP.md", "# Map: (root)\n");
  box.commitAll("seed");

  const scan = await findOrphanMaps(box.root);
  t.check(scan, { ok: true, dirs: ["_content/chat", "solo"] });

  // A box with uncommitted user work is left alone, as the refresh precheck
  // leaves it:

  await box.write("work/draft.md", "wip");
  const busy = await findOrphanMaps(box.root);
  t.check(busy, { ok: false, skippedReason: "uncommitted_work" });
});

// ## Pruning removes the map, the import, and the state entry
//
// A CLAUDE.md that held only the import is deleted with its AGENTS.md mirror
// symlink. A CLAUDE.md with other content keeps that content. A real
// AGENTS.md, or a symlink to anything other than `CLAUDE.md`, is never deleted.
// The box is one made before `agents-md-2026-10` (`legacyInstructions`).
void test("A CLAUDE.md that held only the import is deleted with its AGENTS.md mirror sy...", async (t) => {
  const box = await makeTmpBox({ git: true, legacyInstructions: true });
  await box.write("_content/chat/MAP.md", "# Map: store/chat\n");
  await box.write("_content/chat/CLAUDE.md", "@MAP.md\n");
  await symlink("CLAUDE.md", join(box.root, "_content/chat/AGENTS.md"));
  await box.write("solo/only/a.md", "a");
  await box.write("solo/MAP.md", "# Map: solo\n");
  await box.write("solo/CLAUDE.md", "@MAP.md\n\nKeep solo notes short.\n");
  await box.write("_content/inbox/MAP.md", "# Map: box/inbox\n");
  await box.write("_content/inbox/CLAUDE.md", "@MAP.md\n");
  await box.write("_content/inbox/AGENTS.md", "Hand-written Codex notes.\n");
  await box.write("old/only/a.md", "a");
  await box.write("old/MAP.md", "# Map: old\n");
  await box.write("old/CLAUDE.md", "@MAP.md\n");
  await box.write("shared/AGENTS.md", "Shared notes.\n");
  await symlink("../shared/AGENTS.md", join(box.root, "old/AGENTS.md"));
  box.commitAll("seed");
  const head = await getHead(box.root);
  await saveMapState({ boxRoot: box.root, state: { maps: {
    "solo": { asOf: head, generatedAt: "t" },
    "work": { asOf: head, generatedAt: "t" },
  } } });
  box.commitAll("state");

  const scan = await findOrphanMaps(box.root);
  await pruneOrphanMaps(box.root, scan.ok ? scan.dirs : []);

  t.check(
    {
      chat: [await exists(box, "_content/chat/MAP.md"), await exists(box, "_content/chat/CLAUDE.md"), await exists(box, "_content/chat/AGENTS.md")],
      solo: [await exists(box, "solo/MAP.md"), await box.read("solo/CLAUDE.md")],
      inbox: [await exists(box, "_content/inbox/CLAUDE.md"), await exists(box, "_content/inbox/AGENTS.md")],
      old: [await exists(box, "old/CLAUDE.md"), await exists(box, "old/AGENTS.md")],
      state: Object.keys((await loadMapState(box.root)).maps),
    },
    {
      chat: [false, false, false],
      solo: [false, "\nKeep solo notes short.\n"],
      inbox: [false, true],
      old: [false, true],
      state: ["work"],
    },
  );
});

// In a converted box the instruction file is `AGENTS.md`, pruned the same way: a
// file that held only the import is deleted, and one with other content keeps it.
void test("In a converted box the instruction file is AGENTS.md, pruned the same way:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write("_content/chat/MAP.md", "# Map: store/chat\n");
  await box.write("_content/chat/AGENTS.md", "@MAP.md\n");
  await box.write("solo/only/a.md", "a");
  await box.write("solo/MAP.md", "# Map: solo\n");
  await box.write("solo/AGENTS.md", "@MAP.md\n\nKeep solo notes short.\n");
  box.commitAll("seed");
  const head = await getHead(box.root);
  await saveMapState({ boxRoot: box.root, state: { maps: {
    "solo": { asOf: head, generatedAt: "t" },
    "work": { asOf: head, generatedAt: "t" },
  } } });
  box.commitAll("state");

  const scan = await findOrphanMaps(box.root);
  await pruneOrphanMaps(box.root, scan.ok ? scan.dirs : []);

  t.check(
    {
      chat: [await exists(box, "_content/chat/MAP.md"), await exists(box, "_content/chat/AGENTS.md")],
      solo: [await exists(box, "solo/MAP.md"), await box.read("solo/AGENTS.md")],
    },
    {
      chat: [false, false],
      solo: [false, "\nKeep solo notes short.\n"],
    },
  );

  // After the engine commits the step, nothing is left to prune:

  box.commitAll("prune");
  const again = await findOrphanMaps(box.root);
  t.check(again, { ok: true, dirs: [] });
});

// ## A converted box's import lives in AGENTS.md
//
// In a box converted to `AGENTS.md` (`agents-md-2026-10` in its manifest, as in
// every new box), the import is in a real `AGENTS.md`. Pruning removes it there;
// an `AGENTS.md` left empty is deleted, and one with other content keeps it.
void test("In a box converted to AGENTS.md (agents-md-2026-10 in its manifest, as in eve...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: "none" });
  await box.write("_content/empty/MAP.md", "# Map\n");
  await box.write("_content/empty/AGENTS.md", "@MAP.md\n");
  await box.write("_content/kept/MAP.md", "# Map\n");
  await box.write("_content/kept/AGENTS.md", "@MAP.md\n# Our notes\n");
  await pruneOrphanMaps(box.root, ["_content/empty", "_content/kept"]);
  t.check(
    ({
      empty: await exists(box, "_content/empty/AGENTS.md"),
      kept: await box.read("_content/kept/AGENTS.md"),
      maps: [await exists(box, "_content/empty/MAP.md"), await exists(box, "_content/kept/MAP.md")],
    }),
    {
    empty: false,
    kept: `# Our notes
`,
    maps: [
      false,
      false,
    ],
  },
  );
});
