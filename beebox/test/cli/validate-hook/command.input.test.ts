// # Validation hook input
//
// The installed Claude and Codex plugins call the same validation command. Claude
// Write/Edit hooks provide one `file_path`; Codex `apply_patch` hooks provide a
// patch command that can name several files.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parseHookFilePaths, validateHookPathsResult } from "../../../src/cli/validate-hook/command.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { mkdir, writeFile } from "node:fs/promises";

// ## Claude file tools
void test("Claude file tools", async (t) => {
  t.check(
    parseHookFilePaths({
      tool_name: "Write",
      tool_input: { file_path: "/box/store/Note.doc.card", content: "..." },
    }),
    [
    "/box/store/Note.doc.card",
  ],
  );
});

// ## Codex apply_patch
void test("Codex apply_patch", async (t) => {
  t.check(
    parseHookFilePaths({
      tool_name: "apply_patch",
      tool_input: {
        command: `*** Begin Patch
*** Update File: _content/One.doc.card
@@
-old
+new
*** Add File: _content/Two.doc.card
+new
*** Delete File: _content/Old.doc.card
*** End Patch`,
      },
    }),
    [
    "_content/One.doc.card",
    "_content/Two.doc.card",
    "_content/Old.doc.card",
  ],
  );
});

// Unknown and malformed tool inputs are ignored quietly:
void test("Unknown and malformed tool inputs are ignored quietly:", async (t) => {
  t.check(parseHookFilePaths({ tool_name: "Bash", tool_input: { command: "git status" } }), []);

  t.check(parseHookFilePaths(null), []);
});

// Codex paths are resolved against the hook payload's cwd, not the hook
// subprocess's potentially different cwd:
void test("Codex paths are resolved against the hook payload's cwd, not the hook subproc...", async (t) => {
  t.check(
    parseHookFilePaths({
      cwd: "/box/content",
      tool_name: "apply_patch",
      tool_input: { command: "*** Begin Patch\n*** Update File: _content/One.doc.card\n*** End Patch" },
    }),
    [
    "/box/content/_content/One.doc.card",
  ],
  );
});

// ## Warning severity is preserved
//
// Harness adapters need to show validation errors as failed turns while keeping
// soft instruction-size feedback as a warning.
void test("Harness adapters need to show validation errors as failed turns while keeping...", async (t) => {
  const box = await makeTmpBox();
  await writeFile(`${box.root}/AGENTS.md`, "x".repeat(13000));
  const warning = await validateHookPathsResult([`${box.root}/AGENTS.md`]);
  await box.cleanup();
  t.check({ hasFeedback: warning.feedback?.includes("instruction-file-size"), hasErrors: warning.hasErrors }, {
    hasFeedback: true,
    hasErrors: false,
  });
});

// ## Legacy instruction-file names in a converted box
//
// A box converted to `AGENTS.md` (its manifest records `agents-md-2026-10`,
// as every new box's does) must not gain a `CLAUDE.md`: Claude Code then ignores every `AGENTS.md` in the
// box. Writing one, a `CLAUDE.local.md`, or a `.claude/CLAUDE.md` there is an
// error. (A `CLAUDE.local.md` at the root is already a root stray.)
void test("A box converted to AGENTS.md (its manifest records agents-md-2026-10, as ever...", async (t) => {
  const converted = await makeTmpBox();
  await mkdir(`${converted.root}/.claude`, { recursive: true });
  for (const rel of ["CLAUDE.md", "_content/CLAUDE.local.md", ".claude/CLAUDE.md", "AGENTS.md"]) {
    await writeFile(`${converted.root}/${rel}`, "# Notes\n");
  }
  const results = [];
  for (const rel of ["CLAUDE.md", "_content/CLAUDE.local.md", ".claude/CLAUDE.md", "AGENTS.md"]) {
    results.push({ rel, ...(await validateHookPathsResult([`${converted.root}/${rel}`])) });
  }
  await converted.cleanup();
  t.check(results, [
    {
      rel: "CLAUDE.md",
      feedback: "CLAUDE.md: Name instruction files AGENTS.md. A CLAUDE.md here makes Claude Code ignore every AGENTS.md.",
      hasErrors: true,
    },
    {
      rel: "_content/CLAUDE.local.md",
      feedback: "_content/CLAUDE.local.md: Name instruction files AGENTS.md. A CLAUDE.md here makes Claude Code ignore every AGENTS.md.",
      hasErrors: true,
    },
    {
      rel: ".claude/CLAUDE.md",
      feedback: ".claude/CLAUDE.md: Name instruction files AGENTS.md. A CLAUDE.md here makes Claude Code ignore every AGENTS.md.",
      hasErrors: true,
    },
    {
      rel: "AGENTS.md",
      feedback: null,
      hasErrors: false,
    },
  ]);
});

// A box not yet converted still authors `CLAUDE.md`, so the same write gets no
// finding:
void test("A box not yet converted still authors CLAUDE.md, so the same write gets no fi...", async (t) => {
  const unconverted = await makeTmpBox({ legacyInstructions: true });
  await writeFile(`${unconverted.root}/CLAUDE.md`, "# Notes\n");
  const legacyEdit = await validateHookPathsResult([`${unconverted.root}/CLAUDE.md`]);
  await unconverted.cleanup();
  t.check(legacyEdit, {
    feedback: null,
    hasErrors: false,
  });
});

// ## Package-surface tripwire (Track C)
//
// An edit anywhere under a top-level segment outside the closed vocabulary
// runs the closed-vocabulary root check — not just a direct root-level edit; a
// stray root entry (here `recipes/`, created implicitly by the nested card
// write) is surfaced even though the edited file itself is nested under it:
void test("An edit anywhere under a top-level segment outside the closed vocabulary runs...", async (t) => {
  const strayBox = await makeTmpBox();
  await strayBox.write("recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
  const nestedStrayEdit = await validateHookPathsResult([`${strayBox.root}/recipes/Bread.recipe.card`]);
  await strayBox.cleanup();
  t.check({ hasErrors: nestedStrayEdit.hasErrors, feedback: nestedStrayEdit.feedback }, {
    hasErrors: true,
    feedback: "Box root: recipes: the box root is a closed vocabulary — user content goes under /_content/",
  });
});

// The same tripwire fires for a stray directly at the root — the edited file
// need not be nested under it:
void test("The same tripwire fires for a stray directly at the root — the edited file ne...", async (t) => {
  const rootStrayBox = await makeTmpBox();
  await rootStrayBox.write("recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
  await writeFile(`${rootStrayBox.root}/stray-file.txt`, "hi");
  const strayFileEdit = await validateHookPathsResult([`${rootStrayBox.root}/stray-file.txt`]);
  await rootStrayBox.cleanup();
  t.check(strayFileEdit.hasErrors, true);
});

// ## npm-namespace edit feedback is independent of stray detection
//
// Editing `package.json` (or a lockfile, `tsconfig.json`, `node_modules/`)
// always gets a nudge — even on an otherwise-clean root, where the stray check
// alone would stay silent:
void test("Editing package.json (or a lockfile, tsconfig.json, nodemodules/) always gets...", async (t) => {
  const cleanBox = await makeTmpBox();
  // An edit that keeps the box a box: the beebox dependency is what identifies
  // it (`isBoxRoot`), so the edit adds a dependency beside it.
  const pkg = JSON.parse(await cleanBox.read("package.json"));
  await writeFile(`${cleanBox.root}/package.json`, JSON.stringify({ ...pkg, dependencies: { ...pkg.dependencies, lodash: "4.17.21" } }));
  const cleanEdit = await validateHookPathsResult([`${cleanBox.root}/package.json`]);
  await cleanBox.cleanup();
  t.check(cleanEdit, {
    feedback: "Edit touches the box's npm/package surface (package.json) — make sure this is a deliberate dependency/tooling change, not accidental drift.",
    hasErrors: false,
  });
});

// The same independent nudge fires for a `node_modules/` edit, not just the
// entry itself — and it's a warning (`hasErrors: false`), not a blocker:
void test("The same independent nudge fires for a nodemodules/ edit, not just the entry...", async (t) => {
  const nmBox = await makeTmpBox();
  await nmBox.write("node_modules/pkg/index.js", "module.exports = {};");
  const nmEdit = await validateHookPathsResult([`${nmBox.root}/node_modules/pkg/index.js`]);
  await nmBox.cleanup();
  t.check(nmEdit, {
    feedback: "Edit touches the box's npm/package surface (node_modules) — make sure this is a deliberate dependency/tooling change, not accidental drift.",
    hasErrors: false,
  });
});

// An edit inside a legitimate underscore area or another vocabulary entry
// stays quiet — the tripwire fires only on a top-level segment outside the
// closed vocabulary, or the npm namespace specifically:
void test("An edit inside a legitimate underscore area or another vocabulary entry stays...", async (t) => {
  const quietBox = await makeTmpBox();
  await quietBox.write("_content/inbox/x.doc.card", "---\ntitle: X\n---\n");
  const quietEdit = await validateHookPathsResult([`${quietBox.root}/_content/inbox/x.doc.card`]);
  await quietBox.cleanup();
  t.check(quietEdit.feedback, null);
});
