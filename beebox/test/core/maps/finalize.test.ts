// # Map refresh finalize
//
// Tests for `src/core/maps/finalize/core.ts` — the mechanical post-agent step
// that stamps state and ensures each directory's instruction file carries the
// map include (`AGENTS.md`; `CLAUDE.md` in a box not yet converted).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import { finalize } from "../../../src/core/maps/finalize/core.js";
import { loadMapState, saveMapState } from "../../../src/core/maps/state.js";
import { getHead } from "../../../src/lib/git/core/operations.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { lstat, readlink } from "node:fs/promises";
import { join } from "node:path";

// ## Creates AGENTS.md and stamps state for fresh dirs
//
// When a directory has a MAP.md but no instruction file, finalize writes a stub
// `AGENTS.md` with the `@MAP.md` include and stamps the state file.
//
// `head` is the brief-time HEAD — captured *before* the agent writes, since
// that's what the precheck records on each task.
void test("When a directory has a MAP.md but no instruction file, finalize writes a stub...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L25
  const box = await makeTmpBox({ git: true });
  box.commitAll("seed");
  const head = await getHead(box.root);
  await box.write("inbox/MAP.md", "");
  await box.write("MAP.md", "");

  // doctest:L31
  await finalize({
    boxRoot: box.root,
    tasks: [
      { map: "MAP.md", dir: "", action: "create", head, added: [], deleted: [], children: [] },
      { map: "inbox/MAP.md", dir: "inbox", action: "create", head, added: [], deleted: [], children: [] },
    ],
  });

  // doctest:L39
  t.check([await box.read("AGENTS.md"), await box.read("inbox/AGENTS.md")], ["@MAP.md\n", "@MAP.md\n"]);

  // State file records both at HEAD:

  // doctest:L49
  const state = await loadMapState(box.root);
  t.check(state.maps, {
    "": { asOf: head, generatedAt: isoDate() },
    inbox: { asOf: head, generatedAt: isoDate() },
  });
});

// ## In an unconverted box, a fresh CLAUDE.md gets its AGENTS.md mirror
//
// A box made before `agents-md-2026-10` (`legacyInstructions`) still writes
// `CLAUDE.md`. Codex reads `AGENTS.md`, not `CLAUDE.md`. A stub written without
// the sibling symlink leaves the directory's new MAP invisible to a Codex session
// until some later `generate-docs` run happens to plant one — so finalize links
// the file it just created, and only that file.
void test("A box made before agents-md-2026-10 (legacyInstructions) still writes CLAUDE.md.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L72
  const box = await makeTmpBox({ git: true, legacyInstructions: true });
  box.commitAll("seed");
  const head = await getHead(box.root);
  await box.write("store/MAP.md", "");

  // doctest:L77
  await finalize({
    boxRoot: box.root,
    tasks: [
      { map: "store/MAP.md", dir: "store", action: "create", head, added: [], deleted: [], children: [] },
    ],
  });

  // doctest:L84
  const mirror = join(box.root, "store", "AGENTS.md");
  t.check([(await lstat(mirror)).isSymbolicLink(), await readlink(mirror)], [true, "CLAUDE.md"]);

  // An existing CLAUDE.md that only needed the include line inserted already has a
  // mirror beside it, so nothing is relinked:

  // doctest:L96
  await box.write("people/MAP.md", "");
  await box.write("people/CLAUDE.md", "Hand-written notes.\n");
  await finalize({
    boxRoot: box.root,
    tasks: [
      { map: "people/MAP.md", dir: "people", action: "create", head, added: [], deleted: [], children: [] },
    ],
  });
  t.check(await box.read("people/CLAUDE.md"), "@MAP.md\nHand-written notes.\n");
});

// ## Preserves existing AGENTS.md content
//
// If AGENTS.md already has hand-edited content, the @-include is added at
// the top without disturbing the rest.
void test("If AGENTS.md already has hand-edited content, the @-include is added at the t...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L118
  const box = await makeTmpBox({ git: true });
  const existing = "# Project notes\n\nSome details.\n";
  await box.write("AGENTS.md", existing);
  box.commitAll("seed");
  const head = await getHead(box.root);
  await box.write("MAP.md", "");

  // doctest:L125
  await finalize({
    boxRoot: box.root,
    tasks: [
      { map: "MAP.md", dir: "", action: "create", head, added: [], deleted: [], children: [] },
    ],
  });

  // doctest:L132
  t.check(await box.read("AGENTS.md"), "@MAP.md\n# Project notes\n\nSome details.\n");
});

// ## Idempotent — doesn't duplicate the include
void test("Idempotent — doesn't duplicate the include", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L143
  const box = await makeTmpBox({ git: true });
  await box.write("AGENTS.md", "@MAP.md\n# Notes\n");
  await box.write("MAP.md", "");
  box.commitAll("seed");
  const head = await getHead(box.root);

  // doctest:L149
  await finalize({
    boxRoot: box.root,
    tasks: [
      { map: "MAP.md", dir: "", action: "create", head, added: [], deleted: [], children: [] },
    ],
  });

  // doctest:L156
  t.check(await box.read("AGENTS.md"), "@MAP.md\n# Notes\n");
});

// ## Prunes stale state entries
//
// State entries pointing to directories that no longer exist are removed.
void test("State entries pointing to directories that no longer exist are removed.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L172
  const box = await makeTmpBox({ git: true });
  await box.write("MAP.md", "");
  box.commitAll("seed");
  const head = await getHead(box.root);

  // doctest:L177
  // Pre-seed state with a stale entry for a directory that doesn't exist.
  await saveMapState({
    boxRoot: box.root,
    state: {
      maps: {
        "": { asOf: "old", generatedAt: "t" },
        "ghost-dir": { asOf: "old", generatedAt: "t" },
      },
    },
  });

  // doctest:L188
  await finalize({
    boxRoot: box.root,
    tasks: [
      { map: "MAP.md", dir: "", action: "create", head, added: [], deleted: [], children: [] },
    ],
  });

  // doctest:L195
  const state = await loadMapState(box.root);
  t.check(state.maps, { "": { asOf: "old", generatedAt: "t" } });
});

// ## Only stamps maps the agent actually rewrote
//
// An `update` task's MAP.md already exists before the agent runs, so its mere
// existence proves nothing. Finalize compares each map against the brief-time
// HEAD and leaves untouched ones unstamped unless they pass the coverage check
// (next section), so a run that got through only part of its brief doesn't mark
// the rest current. Here inbox's map does not list its new `triage/`.
void test("An update task's MAP.md already exists before the agent runs, so its mere exi...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L214
  const box = await makeTmpBox({ git: true });
  await box.write("store/MAP.md", "# Map: store\n\n(stale)\n");
  await box.write("inbox/MAP.md", "# Map: inbox\n\n(stale)\n");
  box.commitAll("seed");
  const head = await getHead(box.root);

  // doctest:L220
  // The agent rewrites store's map and then stops — inbox is never touched.
  await box.write("store/MAP.md", "# Map: store\n\n(rewritten)\n");

  // doctest:L223
  const result = await finalize({
    boxRoot: box.root,
    tasks: [
      { map: "store/MAP.md", dir: "store", action: "update", asOf: head, head, added: [], deleted: [], children: [] },
      { map: "inbox/MAP.md", dir: "inbox", action: "update", asOf: head, head, added: ["triage/"], deleted: [], children: ["triage/"] },
    ],
  });

  // doctest:L231
  t.check([result.applied, result.skippedUnchanged], [["store"], ["inbox"]]);

  // The untouched dir keeps its old `asOf`, so the next run picks it up again:

  // doctest:L241
  const state = await loadMapState(box.root);
  t.check(state.maps, { store: { asOf: head, generatedAt: isoDate() } });
});

// ## Banks work the agent left uncommitted
//
// Finalize runs as a procedure run-phase shell, before the engine commits the
// step — so the agent's writes are still in the working tree. Evidence has to
// see them there, or a run that died before committing would bank nothing.
void test("Finalize runs as a procedure run-phase shell, before the engine commits the s...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L260
  const box = await makeTmpBox({ git: true });
  await box.write("store/MAP.md", "# Map: store\n\n(stale)\n");
  box.commitAll("seed");
  const head = await getHead(box.root);

  // doctest:L265
  // Rewritten but never committed — the state after an agent runs out of turns.
  await box.write("store/MAP.md", "# Map: store\n\n(rewritten)\n");

  // doctest:L268
  const result = await finalize({
    boxRoot: box.root,
    tasks: [
      { map: "store/MAP.md", dir: "store", action: "update", asOf: head, head, added: [], deleted: [], children: [] },
    ],
  });
  t.check(result.applied, ["store"]);
});

// ## A map that is already correct is stamped without a change
//
// A map with no state entry is a `create` task, and a correct one needs no
// rewrite. Finalize used to stamp only rewritten maps, so such a map came back
// as `create` in every run. It now stamps any map that passes the coverage
// check (`maps-verify.doctest.md`). The same holds for an update whose only
// addition is a plain file, which the map should not list.
void test("A map with no state entry is a create task, and a correct one needs no rewrite.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L292
  const box = await makeTmpBox({ git: true });
  await box.write("store/MAP.md", "# Map: store\n\n- `notes/` — meeting notes\n- `refs/`\n");
  await box.write("inbox/MAP.md", "# Map: store/inbox\n\n- `triage/`\n");
  box.commitAll("seed");
  const head = await getHead(box.root);

  // doctest:L298
  const result = await finalize({
    boxRoot: box.root,
    tasks: [
      { map: "store/MAP.md", dir: "store", action: "create", head, added: [], deleted: [], children: ["notes/", "plain.md", "refs/"] },
      { map: "inbox/MAP.md", dir: "inbox", action: "create", head, added: [], deleted: [], children: ["triage/"] },
    ],
  });
  t.check([result.applied, result.verified, result.skippedUnchanged, result.coverageFailures], [
    [],
    ["store"],
    ["inbox"],
    [{ dir: "inbox", problems: ['header is "# Map: store/inbox", expected "# Map: inbox"'] }],
  ]);

  // The verified map is stamped and gets its `AGENTS.md` include; the stale-header
  // one is left for the agent to rewrite:

  // doctest:L320
  const state = await loadMapState(box.root);
  t.check(state.maps, { store: { asOf: head, generatedAt: isoDate() } });
  t.check((await box.read("store/AGENTS.md")).trim(), "@MAP.md");
});

// ## A rewritten map that fails the check is stamped and reported
//
// A rewrite is still evidence the agent reached the map, so it is stamped as
// before. The coverage failure is reported so the run log shows it.
void test("A rewrite is still evidence the agent reached the map, so it is stamped as be...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L340
  const box = await makeTmpBox({ git: true });
  await box.write("store/MAP.md", "# Map: store\n");
  box.commitAll("seed");
  const head = await getHead(box.root);
  await box.write("store/MAP.md", "# Map: store\n\n- `notes/`\n");

  // doctest:L346
  const result = await finalize({
    boxRoot: box.root,
    tasks: [
      { map: "store/MAP.md", dir: "store", action: "update", asOf: head, head, added: ["refs/"], deleted: [], children: ["notes/", "refs/"] },
    ],
  });
  t.check([result.applied, result.coverageFailures], [["store"], [{ dir: "store", problems: ["does not list refs/"] }]]);
});

// ## Stamps the brief's HEAD, not the HEAD at finalize time
//
// The map was verified against the brief's listing. If another writer commits a
// new child while the agent runs, stamping the later HEAD would hide that child
// from every future diff. Stamping the brief's HEAD leaves it visible as an
// addition on the next run.
void test("The map was verified against the brief's listing.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L371
  const box = await makeTmpBox({ git: true });
  await box.write("store/notes/a.md", "a");
  await box.write("store/refs/b.md", "b");
  await box.write("store/MAP.md", "# Map: store\n\n- `notes/`\n- `refs/`\n");
  box.commitAll("seed");
  const briefHead = await getHead(box.root);

  // doctest:L378
  await box.write("store/urgent/c.md", "c");
  box.commitAll("another writer adds store/urgent/");

  // doctest:L381
  await finalize({
    boxRoot: box.root,
    tasks: [
      { map: "store/MAP.md", dir: "store", action: "create", head: briefHead, added: [], deleted: [], children: ["notes/", "refs/"] },
    ],
  });
  const state = await loadMapState(box.root);
  t.check(state.maps, { store: { asOf: briefHead, generatedAt: isoDate() } });
});
