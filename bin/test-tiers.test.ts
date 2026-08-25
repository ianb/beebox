// Tests for the ordinary/careful tiers — list parsing, the argv the ledger
// wrapper builds, and the selector's exclusion of careful files. A `.test.ts`
// rather than the doctest this directory's CLAUDE.md asks for, for the same
// reason bin/test-select.test.ts is one: the thing under test decides which
// doctests run, so exercising it from inside that suite is circular.
//
//   node --import tsx --test bin/test-tiers.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  carefulExclusions,
  parseCarefulList,
  readCarefulList,
  taprcTestFiles,
  tierCommand,
  TierListError,
} from "./test-tiers.js";
import { selectTests } from "./test-select-lib.js";
import type { TestGraph } from "./test-graph-query.js";

/** A fixture package: `files` maps package-relative path -> contents. */
function fixture(files: Record<string, string>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "test-tiers-"));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// ── the careful list ────────────────────────────────────────────────────────

test("comments, trailing comments and blank lines are not test paths", () => {
  const text = ["# why this tier exists", "", "test/a.doctest.md", "  test/b.doctest.md  ", ""];
  assert.deepEqual(parseCarefulList(text.join("\n")), ["test/a.doctest.md", "test/b.doctest.md"]);
});

test("a listed path that does not exist fails loudly", () => {
  // Silently shrinking the tier is the failure the list exists to prevent: the
  // run would stay green while testing less than it claims to.
  const fx = fixture({
    "test/careful.txt": "test/here.doctest.md\ntest/gone.doctest.md\n",
    "test/here.doctest.md": "# here\n",
  });
  try {
    assert.throws(() => readCarefulList(fx.root), TierListError);
    assert.throws(() => readCarefulList(fx.root), /test\/gone\.doctest\.md/);
  } finally {
    fx.cleanup();
  }
});

test("no careful.txt at all is an empty tier, not an error", () => {
  const fx = fixture({ "test/a.doctest.md": "# a\n" });
  try {
    assert.deepEqual(readCarefulList(fx.root), []);
  } finally {
    fx.cleanup();
  }
});

test("the repo's own careful.txt exists and every path in it is real", () => {
  // The list is committed and the files it names move; this is the guard that
  // says so at `pnpm test` time rather than at the next batched run.
  assert.ok(carefulExclusions().length > 0);
  for (const path of carefulExclusions()) assert.match(path, /^callback-box\/test\//);
});

// ── what `.taprc` includes ──────────────────────────────────────────────────

test("taprc include/exclude are read, not restated", () => {
  const fx = fixture({
    ".taprc": "include:\n  - test/**/*.doctest.md\nexclude:\n  - test/skipme/**\n",
    "test/a.doctest.md": "# a\n",
    "test/skipme/b.doctest.md": "# b\n",
    "test/c.test.ts": "",
  });
  try {
    assert.deepEqual(taprcTestFiles(fx.root), ["test/a.doctest.md"]);
  } finally {
    fx.cleanup();
  }
});

// ── argv ────────────────────────────────────────────────────────────────────

const TAPRC_FILES = ["test/a.doctest.md", "test/flaky.doctest.md", "test/b.test.ts"];
const CAREFUL = ["test/flaky.doctest.md"];

test("the ordinary tier runs everything the careful tier does not", () => {
  assert.deepEqual(
    tierCommand({ command: ["tap"], tier: "ordinary", taprcFiles: TAPRC_FILES, careful: CAREFUL }),
    ["tap", "test/a.doctest.md", "test/b.test.ts"],
  );
});

test("the careful tier runs its own list, one job at a time", () => {
  assert.deepEqual(
    tierCommand({ command: ["tap"], tier: "careful", taprcFiles: TAPRC_FILES, careful: CAREFUL }),
    ["tap", "-j1", "test/flaky.doctest.md"],
  );
});

test("a caller's own -j wins over the tier's", () => {
  assert.deepEqual(
    tierCommand({
      command: ["tap", "-j2"],
      tier: "careful",
      taprcFiles: TAPRC_FILES,
      careful: CAREFUL,
    }),
    ["tap", "-j2", "test/flaky.doctest.md"],
  );
});

test("explicit files pass through — that is how test:changed runs a selection", () => {
  assert.deepEqual(
    tierCommand({
      command: ["tap", "test/a.doctest.md"],
      tier: "ordinary",
      taprcFiles: TAPRC_FILES,
      careful: CAREFUL,
    }),
    ["tap", "test/a.doctest.md"],
  );
});

test("a command that is not tap is not rewritten", () => {
  const command = ["pnpm", "exec", "vitest"];
  assert.deepEqual(
    tierCommand({ command, tier: "ordinary", taprcFiles: TAPRC_FILES, careful: CAREFUL }),
    command,
  );
});

test("an empty tier refuses to become a bare `tap`", () => {
  // A bare `tap` falls back to .taprc's includes and runs EVERYTHING — the
  // exact fragility that made shell expansion the rejected design.
  assert.throws(
    () => tierCommand({ command: ["tap"], tier: "careful", taprcFiles: TAPRC_FILES, careful: [] }),
    TierListError,
  );
});

// ── the exclude wiring ──────────────────────────────────────────────────────

test("the selector drops careful files unless the branch changed one", () => {
  const box = "callback-box/";
  const careful = carefulExclusions();
  const member = careful[0];
  assert.ok(member !== undefined);
  const graph: TestGraph = {
    tests: new Map([
      [member, new Set([`${box}src/shared.ts`])],
      [`${box}test/ordinary.doctest.md`, new Set([`${box}src/shared.ts`])],
    ]),
    universe: new Set([`${box}src/shared.ts`]),
    unresolved: new Set(),
    ambiguousEdges: 0,
    buildMs: 0,
  };
  assert.deepEqual(
    selectTests({ graph, changed: [`${box}src/shared.ts`], exclude: careful }).selected,
    [`${box}test/ordinary.doctest.md`],
  );
  assert.deepEqual(selectTests({ graph, changed: [member], exclude: careful }).selected, [member]);
});
