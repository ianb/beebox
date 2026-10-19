// # doc-check: backticked repo paths
//
// Prose names files in single-backtick spans (`beebox/src/core/x.ts`). The check
// reports a span that starts with a repo directory, ends in a file extension, and
// resolves nowhere. Pure logic (fs injected).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { candidatePath, findFilePathProblems, repairFilePaths } from "../../../src/dev/doc-check/file-paths.js";

// A tiny fake tree.
const files = [
  "beebox/docs/cards/format.md",
  "beebox/docs/cards/schemas.md",
  "beebox/src/core/card-io.ts",
  "beebox/test/dev/doc-check/helper.ts",
  "issues/closed/bugs/2026-01-01-old-bug.md",
  "workstreams-app/src/router/lifecycle.ts",
];
const fileExists = (p: string) => files.includes(p);
const check = (docRel: string, content: string) => findFilePathProblems({ docRel, content, fileExists });
const tokens = (docRel: string, content: string) => check(docRel, content).map((p) => `${p.line} ${p.kind} ${p.token}`);

// ## A path resolves at the doc's directory, its package root, or the monorepo root
void test("A path resolves at the doc's directory, its package root, or the monorepo root", async (t) => {
  // doctest:L27
  t.check(
    // Relative to the doc's own directory (beebox/test/).
    tokens("beebox/test/AGENTS.md", "Helpers live in `dev/doc-check/helper.ts`."),
    [],
  );

  // doctest:L31
  t.check(
    // Relative to the package root (beebox/), from a doc deeper in the package.
    tokens("beebox/docs/cards/format.md", "See `docs/cards/schemas.md` and `src/core/card-io.ts`."),
    [],
  );

  // doctest:L35
  t.check(
    // A root-level doc naming a file under another package, from the monorepo root.
    tokens("bin/AGENTS.md", "The router lives in `workstreams-app/src/router/lifecycle.ts`."),
    [],
  );

  // doctest:L39
  t.check(
    // A trailing `:line` or `:start-end` suffix is stripped before resolving.
    tokens("beebox/docs/x.md", "`src/core/card-io.ts:40-52` and `src/core/card-io.ts:7`"),
    [],
  );
});

// ## A path that resolves nowhere is reported with its line
void test("A path that resolves nowhere is reported with its line", async (t) => {
  // doctest:L47
  t.check(tokens("beebox/docs/x.md", "intro\n\nThe old file was `src/core/gone.ts`."), [
    "3 missing src/core/gone.ts",
  ]);

  // doctest:L50
  t.check(
    // A span that wraps across lines inside one paragraph still pairs correctly,
    // so the next span on the second line is read as a path, not as prose.
    tokens("beebox/docs/x.md", "Run `bbx\nhealth` first; see `src/core/gone.ts`."),
    [
    "2 missing src/core/gone.ts",
  ],
  );
});

// ## Placeholders, fenced code, and extensionless tokens are not candidates
void test("Placeholders, fenced code, and extensionless tokens are not candidates", async (t) => {
  // doctest:L59
  t.check(candidatePath("src/schemas/<type>/list-entry.tsx", "beebox/docs/x.md"), undefined);

  // doctest:L62
  t.check(candidatePath("src/core/.../x.ts", "beebox/docs/x.md"), undefined);

  // doctest:L65
  t.check(
    // Fenced code illustrates; it is not a reference.
    tokens("beebox/docs/x.md", "```md\nsee `src/core/gone.ts`\n```\n"),
    [],
  );

  // doctest:L69
  t.check(
    // No file extension: a directory mention, not a file.
    tokens("beebox/docs/x.md", "Everything under `src/core/gone/` and `bin/launch-worktree-session`."),
    [],
  );

  // doctest:L73
  t.check(
    // A token that does not start with a repo directory (box-relative) never matches.
    candidatePath("_config/box.json", "beebox/docs/x.md"),
    undefined,
  );
});

// ## Box-facing docs name the box's own tree
void test("Box-facing docs name the box's own tree", async (t) => {
  // doctest:L81
  t.check(
    // docs/box/ is shipped into box-docs/ and read inside a box.
    tokens("beebox/docs/box/tricks.md", "Rules land in `.claude/rules/card-memo.md` and `src/schemas/AGENTS.md`."),
    [],
  );

  // doctest:L85
  t.check(
    // The same tokens in a dev doc are checked.
    tokens("beebox/docs/x.md", "Rules land in `.claude/rules/card-memo.md`."),
    [
    "1 missing .claude/rules/card-memo.md",
  ],
  );
});

// ## An issue that moved to closed/ is a distinct, fixable finding
void test("An issue that moved to closed/ is a distinct, fixable finding", async (t) => {
  // doctest:L93
  const content = "Fixed by `issues/bugs/2026-01-01-old-bug.md:3`.";
  const problems = check("beebox/docs/x.md", content);
  t.check(problems.map((p) => `${p.kind} ${p.suggestion}`), [
    "moved-to-closed issues/closed/bugs/2026-01-01-old-bug.md:3",
  ]);

  // doctest:L98
  t.check(repairFilePaths(content, problems), "Fixed by `issues/closed/bugs/2026-01-01-old-bug.md:3`.");

  // doctest:L101
  // An issue with no closed/ copy is plain missing, and repair leaves it.
  const gone = check("beebox/docs/x.md", "`issues/bugs/2026-01-02-never.md`");
  t.check(gone.map((p) => p.kind), [
    "missing",
  ]);
});
