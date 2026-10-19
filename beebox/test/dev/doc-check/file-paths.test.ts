// # doc-check: backticked repo paths
//
// Prose names files in single-backtick spans (`beebox/src/core/x.ts`). The check
// reports a span that starts with a repo directory, ends in a file extension, and
// resolves nowhere. Pure logic (fs injected).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { candidatePath, findFilePathProblems, findMovedPathMentions, repairFilePaths } from "../../../src/dev/doc-check/file-paths.js";
import { buildBasenameLookup } from "../../../src/dev/doc-check/link-repair.js";

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
  t.check(
    // Relative to the doc's own directory (beebox/test/).
    tokens("beebox/test/AGENTS.md", "Helpers live in `dev/doc-check/helper.ts`."),
    [],
  );

  t.check(
    // Relative to the package root (beebox/), from a doc deeper in the package.
    tokens("beebox/docs/cards/format.md", "See `docs/cards/schemas.md` and `src/core/card-io.ts`."),
    [],
  );

  t.check(
    // A root-level doc naming a file under another package, from the monorepo root.
    tokens("bin/AGENTS.md", "The router lives in `workstreams-app/src/router/lifecycle.ts`."),
    [],
  );

  t.check(
    // A trailing `:line` or `:start-end` suffix is stripped before resolving.
    tokens("beebox/docs/x.md", "`src/core/card-io.ts:40-52` and `src/core/card-io.ts:7`"),
    [],
  );
});

// ## A path that resolves nowhere is reported with its line
void test("A path that resolves nowhere is reported with its line", async (t) => {
  t.check(tokens("beebox/docs/x.md", "intro\n\nThe old file was `src/core/gone.ts`."), [
    "3 missing src/core/gone.ts",
  ]);

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
  t.check(candidatePath("src/schemas/<type>/list-entry.tsx", "beebox/docs/x.md"), undefined);

  t.check(candidatePath("src/core/.../x.ts", "beebox/docs/x.md"), undefined);

  t.check(
    // Fenced code illustrates; it is not a reference.
    tokens("beebox/docs/x.md", "```md\nsee `src/core/gone.ts`\n```\n"),
    [],
  );

  t.check(
    // No file extension: a directory mention, not a file.
    tokens("beebox/docs/x.md", "Everything under `src/core/gone/` and `bin/launch-worktree-session`."),
    [],
  );

  t.check(
    // A token that does not start with a repo directory (box-relative) never matches.
    candidatePath("_config/box.json", "beebox/docs/x.md"),
    undefined,
  );
});

// ## Box-facing docs name the box's own tree
void test("Box-facing docs name the box's own tree", async (t) => {
  t.check(
    // docs/box/ is shipped into box-docs/ and read inside a box.
    tokens("beebox/docs/box/tricks.md", "Rules land in `.claude/rules/card-memo.md` and `src/schemas/AGENTS.md`."),
    [],
  );

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
  const content = "Fixed by `issues/bugs/2026-01-01-old-bug.md:3`.";
  const problems = check("beebox/docs/x.md", content);
  t.check(problems.map((p) => `${p.kind} ${p.suggestion}`), [
    "moved issues/closed/bugs/2026-01-01-old-bug.md:3",
  ]);

  t.check(repairFilePaths({ content, problems }), "Fixed by `issues/closed/bugs/2026-01-01-old-bug.md:3`.");

  // An issue with no closed/ copy is plain missing, and repair leaves it.
  const gone = check("beebox/docs/x.md", "`issues/bugs/2026-01-02-never.md`");
  t.check(gone.map((p) => p.kind), [
    "missing",
  ]);
});

// A tree where plans moved to implemented-plans/ and an issue closed.
const movedFiles = [
  "beebox/docs/implemented-plans/zz-shipped-plan.md",
  "beebox/docs/plans/zz-twin.md",
  "beebox/docs/unimplemented-plans/zz-twin.md",
  "beebox/docs/testing/zz-generic.md",
  "issues/closed/features/2026-01-03-zz-closed-feature.md",
];
const movedExists = (p: string) => movedFiles.includes(p);
const lookup = buildBasenameLookup(movedFiles);
const moved = (docRel: string, content: string) =>
  findFilePathProblems({ docRel, content, fileExists: movedExists, basenameLookup: lookup }).map((p) => `${p.kind} ${p.token} -> ${p.suggestion ?? (p.candidates ?? []).join(" ")}`);

// ## A plan or issue that moved lifecycle directories is relocated by unique basename
void test("A plan or issue that moved lifecycle directories is relocated by unique basename", async (t) => {
  t.check(
    // The rewrite keeps the token's style: package-relative, monorepo-relative,
    // and any :line suffix.
    moved("beebox/AGENTS.md", "See `docs/plans/zz-shipped-plan.md:12` and `beebox/docs/plans/zz-shipped-plan.md`."),
    [
      "moved docs/plans/zz-shipped-plan.md:12 -> docs/implemented-plans/zz-shipped-plan.md:12",
      "moved beebox/docs/plans/zz-shipped-plan.md -> beebox/docs/implemented-plans/zz-shipped-plan.md",
    ],
  );

  t.check(
    // An issue that moved categories as it closed (bugs/ to closed/features/).
    moved("bin/AGENTS.md", "Filed as `issues/bugs/2026-01-03-zz-closed-feature.md`."),
    ["moved issues/bugs/2026-01-03-zz-closed-feature.md -> issues/closed/features/2026-01-03-zz-closed-feature.md"],
  );

  const content = "Shipped: `docs/plans/zz-shipped-plan.md`.";
  t.check(
    repairFilePaths({ content, problems: findFilePathProblems({ docRel: "beebox/AGENTS.md", content, fileExists: movedExists, basenameLookup: lookup }) }),
    "Shipped: `docs/implemented-plans/zz-shipped-plan.md`.",
  );
});

// ## Two plan or issue matches are reported, and a non-plan path is never relocated
void test("Two plan or issue matches are reported, and a non-plan path is never relocated", async (t) => {
  t.check(moved("beebox/AGENTS.md", "`docs/implemented-plans/zz-twin.md`"), [
    "ambiguous docs/implemented-plans/zz-twin.md -> beebox/docs/plans/zz-twin.md beebox/docs/unimplemented-plans/zz-twin.md",
  ]);

  t.check(
    // A generic doc that shares its basename with a file elsewhere is a
    // different file as often as a moved one: it stays missing.
    moved("beebox/AGENTS.md", "`docs/zz-generic.md`"),
    ["missing docs/zz-generic.md -> "],
  );
});

// ## Code and YAML mentions of a moved plan are found bare or backticked
void test("Code and YAML mentions of a moved plan are found bare or backticked", async (t) => {
  const source = [
    "// Design: docs/plans/zz-shipped-plan.md, track 2.",
    "// Issue `issues/bugs/2026-01-03-zz-closed-feature.md`; see ../docs/plans/zz-shipped-plan.md.",
    "// https://example.com/docs/plans/zz-shipped-plan.md and x/docs/plans/zz-shipped-plan.md",
    "// Gone: docs/plans/zz-never.md",
  ].join("\n");
  const problems = findMovedPathMentions({ docRel: "beebox/src/core/x.ts", content: source, fileExists: movedExists, basenameLookup: lookup });
  t.check(problems.map((p) => `${p.line} ${p.kind} ${p.token} -> ${p.suggestion}`), [
    "1 moved docs/plans/zz-shipped-plan.md -> docs/implemented-plans/zz-shipped-plan.md",
    "2 moved issues/bugs/2026-01-03-zz-closed-feature.md -> issues/closed/features/2026-01-03-zz-closed-feature.md",
  ]);

  // Relative paths, URLs, and longer paths that contain the token are left alone.
  await t.checkText(repairFilePaths({ content: source, problems, bare: true }), [
    "// Design: docs/implemented-plans/zz-shipped-plan.md, track 2.",
    "// Issue `issues/closed/features/2026-01-03-zz-closed-feature.md`; see ../docs/plans/zz-shipped-plan.md.",
    "// https://example.com/docs/plans/zz-shipped-plan.md and x/docs/plans/zz-shipped-plan.md",
    "// Gone: docs/plans/zz-never.md",
  ].join("\n"));

  t.check(
    // YAML: a schedule or audit config comment, written monorepo-relative.
    findMovedPathMentions({ docRel: "schedules/x/schedule.yaml", content: "# beebox/docs/plans/zz-shipped-plan.md", fileExists: movedExists, basenameLookup: lookup }).map((p) => p.suggestion),
    ["beebox/docs/implemented-plans/zz-shipped-plan.md"],
  );
});
