// # doc-move: move one doc and rewrite the references to it
//
// A move knows which file moved, so it rewrites only references that resolve
// to the old path — never a same-basename file elsewhere — and re-expresses
// the moved file's own links from its new directory. Link labels and prose
// paths that name the old file follow too, and test files are rewritten. A
// reference it cannot rewrite safely refuses the whole move before any write.
// The move never stages: it prints the `git add` line for each repository.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { formatDocMove, moveDoc, planDocMove } from "../../lib/doc-move.js";

const tree: Record<string, string> = {
  "issues/features/a.md": `---
title: A
workstream: unattached
design: ../../beebox/docs/plans/p.md
---

See [b](../bugs/b.md), [sibling](c.md), [self](a.md#top), and [gone](../bugs/gone.md).
Quoted syntax stays: \`[q](../bugs/b.md)\`.

[defined]: ../bugs/b.md
`,
  "issues/features/c.md": "Related: [a](a.md).\n",
  "issues/bugs/b.md": "Moved from [a](../features/a.md#sec); not [the watch one](../watch/a.md).\n",
  "issues/watch/a.md": "A different file with the same basename.\n",
  // A label spelling the old path follows its link; a bare prose path follows too.
  "issues/bugs/label.md": "Spelled [`issues/features/a.md`](../features/a.md) and [features/a.md](../features/a.md).\nProse: see issues/features/a.md, not issues/watch/a.md.\n",
  "beebox/test/x.test.ts": "// Fixture from issues/features/a.md:L3, and issues/watch/a.md stays.\n",
  "bin/lib/x.sh": "# Background: issues/features/a.md\n",
  "beebox/docs/plans/p.md": `---
title: P
status: draft
workstream: unattached
issues:
  - ../../../issues/features/a.md
---
Backticked \`issues/features/a.md\`.

[ref]: ../../../issues/features/a.md
`,
  "beebox/docs/implemented-plans/old.md": "Historical `issues/features/a.md`, linked [here](../../../issues/features/a.md).\n<a href=\"../../../issues/features/a.md\">a</a>\nLabelled [`issues/features/a.md`](../../../issues/features/a.md).\n",
  "private-issues/bugs/q.md": "Public context: [a](../../issues/features/a.md).\n",
};

function plan(from: string, to: string): ReturnType<typeof planDocMove> {
  return planDocMove({
    from,
    to,
    sources: Object.keys(tree),
    read: (rel) => tree[rel] ?? "",
    exists: (rel) => rel in tree || Object.keys(tree).some((f) => f.startsWith(`${rel}/`)),
  });
}

// ## Closing an issue: own links re-depth, inbound links, labels, and prose follow, look-alikes stay
void test("Closing an issue: own links re-depth, inbound links, labels, and prose follow, look-alikes stay", async (t) => {
  const p = plan("issues/features/a.md", "issues/closed/features/a.md");
  t.check(p.moved.content, `---
title: A
workstream: unattached
design: ../../../beebox/docs/plans/p.md
---

See [b](../../bugs/b.md), [sibling](../../features/c.md), [self](a.md#top), and [gone](../../bugs/gone.md).
Quoted syntax stays: \`[q](../bugs/b.md)\`.

[defined]: ../../bugs/b.md
`);
  t.check(p.files.map((f) => [f.path, f.repository, f.rewrites.map((r) => `L${String(r.line)} ${r.kind} ${r.from} -> ${r.to}`)]), [
    ["issues/features/c.md", "public", ["L1 link a.md -> ../closed/features/a.md"]],
    ["issues/bugs/b.md", "public", ["L1 link ../features/a.md#sec -> ../closed/features/a.md#sec"]],
    ["issues/bugs/label.md", "public", [
      "L1 link ../features/a.md -> ../closed/features/a.md",
      "L1 link ../features/a.md -> ../closed/features/a.md",
      "L1 path issues/features/a.md -> issues/closed/features/a.md",
      "L1 label features/a.md -> closed/features/a.md",
      "L2 prose issues/features/a.md -> issues/closed/features/a.md",
    ]],
    ["beebox/test/x.test.ts", "public", ["L1 path issues/features/a.md:L3 -> issues/closed/features/a.md:L3"]],
    ["bin/lib/x.sh", "public", ["L1 path issues/features/a.md -> issues/closed/features/a.md"]],
    ["beebox/docs/plans/p.md", "public", [
      "L6 link ../../../issues/features/a.md -> ../../../issues/closed/features/a.md",
      "L8 path issues/features/a.md -> issues/closed/features/a.md",
      "L10 link ../../../issues/features/a.md -> ../../../issues/closed/features/a.md",
    ]],
    // Historical records keep their backticked prose paths; links, their
    // labels, and HTML hrefs follow.
    ["beebox/docs/implemented-plans/old.md", "public", [
      "L1 link ../../../issues/features/a.md -> ../../../issues/closed/features/a.md",
      "L2 prose ../../../issues/features/a.md -> ../../../issues/closed/features/a.md",
      "L3 link ../../../issues/features/a.md -> ../../../issues/closed/features/a.md",
      "L3 label issues/features/a.md -> issues/closed/features/a.md",
    ]],
    ["private-issues/bugs/q.md", "private", ["L1 link ../../issues/features/a.md -> ../../issues/closed/features/a.md"]],
  ]);
  t.check(p.files.find((f) => f.path === "issues/bugs/label.md")?.content,
    "Spelled [`issues/closed/features/a.md`](../closed/features/a.md) and [closed/features/a.md](../closed/features/a.md).\nProse: see issues/closed/features/a.md, not issues/watch/a.md.\n");
  t.check(p.files.find((f) => f.path === "beebox/docs/implemented-plans/old.md")?.content,
    "Historical `issues/features/a.md`, linked [here](../../../issues/closed/features/a.md).\n<a href=\"../../../issues/closed/features/a.md\">a</a>\nLabelled [`issues/closed/features/a.md`](../../../issues/closed/features/a.md).\n");
  t.check(p.files.find((f) => f.path === "beebox/test/x.test.ts")?.content,
    "// Fixture from issues/closed/features/a.md:L3, and issues/watch/a.md stays.\n");
  // The moved file's own link to a missing file is reported; it does not block.
  t.check(p.notices, [
    { path: "issues/closed/features/a.md", line: null, message: "own link to a missing file: issues/bugs/gone.md", blocking: false },
  ]);
});

// ## A plan path named in prose follows a plan move
void test("A plan path named in prose follows a plan move", async (t) => {
  const files: Record<string, string> = {
    "beebox/docs/plans/s.md": "plan",
    "canvas-loop/src/gallery/g/task.md": "Example for the sound plan (beebox/docs/plans/s.md): six strings.\n",
    "beebox/docs/secrets.md": "Rationale: [`plans/s.md`](plans/s.md).\n",
    // Longer paths that start with the old one name other files.
    "beebox/docs/backups.md": "Kept: beebox/docs/plans/s.md.bak, beebox/docs/plans/s.mdx, and beebox/docs/plans/s.md/notes.\n",
  };
  const p = planDocMove({
    from: "beebox/docs/plans/s.md",
    to: "beebox/docs/implemented-plans/s.md",
    sources: Object.keys(files),
    read: (rel) => files[rel] ?? "",
    exists: (rel) => rel in files,
  });
  t.check(p.files.map((f) => [f.path, f.content]), [
    ["canvas-loop/src/gallery/g/task.md", "Example for the sound plan (beebox/docs/implemented-plans/s.md): six strings.\n"],
    ["beebox/docs/secrets.md", "Rationale: [`implemented-plans/s.md`](implemented-plans/s.md).\n"],
  ]);
  t.check(p.notices, []);
});

// ## A path token two files could answer to blocks the move
void test("A path token two files could answer to blocks the move", async (t) => {
  const files: Record<string, string> = {
    "beebox/docs/plans/z.md": "plan",
    "docs/plans/z.md": "a root docs copy",
    "beebox/src/y.ts": "// see docs/plans/z.md\n",
  };
  const p = planDocMove({
    from: "beebox/docs/plans/z.md",
    to: "beebox/docs/implemented-plans/z.md",
    sources: Object.keys(files),
    read: (rel) => files[rel] ?? "",
    exists: (rel) => rel in files,
  });
  t.check(p.files, []);
  t.check(p.notices, [{
    path: "beebox/src/y.ts",
    line: 1,
    message: "ambiguous path `docs/plans/z.md` (matches beebox/docs/plans/z.md, docs/plans/z.md); not rewritten",
    blocking: true,
  }]);
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function repo(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "add", "-A");
  git(root, "commit", "-q", "--no-verify", "-m", "fixture");
}

// An issue body long enough for git's rename detection to see the rewritten
// file as the same one.
const BODY = "The tension, described over a few lines.\n".repeat(6);

// ## moveDoc renames and rewrites in both repositories and leaves both indexes alone
//
// A parallel worker's staged change stays the only staged change, so its next
// commit carries nothing of the move. The report names each repository's
// paths to stage, and a rewritten file that already held other edits.
void test("moveDoc renames and rewrites in both repositories and leaves both indexes alone", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-move-"));
  t.teardown(() => fs.rmSync(root, { recursive: true, force: true }));
  repo(root, {
    ".gitignore": "private-issues/\n",
    "issues/bugs/a.md": `See [b](b.md).\n${BODY}`,
    "issues/bugs/b.md": "See [a](a.md).\n",
    "issues/bugs/w.md": "A worker's file.\n",
    "issues/closed/bugs/taken.md": "x\n",
    "issues/bugs/taken.md": "y\n",
  });
  repo(path.join(root, "private-issues"), { "bugs/q.md": "Public context: [a](../../issues/bugs/a.md).\n" });
  // Another worker staged its own edit; this session has an unstaged edit in b.md.
  fs.appendFileSync(path.join(root, "issues/bugs/w.md"), "Edited.\n");
  git(root, "add", "issues/bugs/w.md");
  fs.appendFileSync(path.join(root, "issues/bugs/b.md"), "Unrelated edit.\n");

  const result = moveDoc({ repoRoot: root, from: "issues/bugs/a.md", to: "issues/closed/bugs/", dryRun: false });
  t.check(fs.readFileSync(path.join(root, "issues/closed/bugs/a.md"), "utf8"), `See [b](../../bugs/b.md).\n${BODY}`);
  t.check(fs.readFileSync(path.join(root, "issues/bugs/b.md"), "utf8"), "See [a](../closed/bugs/a.md).\nUnrelated edit.\n");
  t.check(fs.readFileSync(path.join(root, "private-issues/bugs/q.md"), "utf8"), "Public context: [a](../../issues/closed/bugs/a.md).\n");
  t.check(git(root, "diff", "--cached", "--name-only"), "issues/bugs/w.md\n");
  t.check(git(path.join(root, "private-issues"), "diff", "--cached", "--name-only"), "");
  t.check(result.stage, { public: ["issues/bugs/a.md", "issues/closed/bugs/a.md", "issues/bugs/b.md"], private: ["bugs/q.md"] });
  t.check(result.dirtyBefore, ["issues/bugs/b.md"]);
  t.check(formatDocMove(result, { dryRun: false }).stdout, `moved issues/bugs/a.md -> issues/closed/bugs/a.md
  own links, by line in issues/bugs/a.md:
  L1 link b.md -> ../../bugs/b.md
rewrote issues/bugs/b.md
  L1 link a.md -> ../closed/bugs/a.md
private-issues (commit inside that repo): rewrote private-issues/bugs/q.md
  L1 link ../../issues/bugs/a.md -> ../../issues/closed/bugs/a.md
2 reference(s) rewritten in 2 file(s)
not staged; stage this move with:
  git add -A -- issues/bugs/a.md issues/closed/bugs/a.md issues/bugs/b.md
  git -C private-issues add -A -- bugs/q.md
other uncommitted changes were already in: issues/bugs/b.md; stage those files by hunk (git add -p)
`);
  // Staging the printed paths records a rename (git detects it by content).
  git(root, "add", "-A", "--", ...result.stage.public);
  t.check(git(root, "diff", "--cached", "--name-status", "-M").split("\n").filter((l) => l.includes("a.md")).map((l) => l.replace(/^R\d+/, "R")), ["R\tissues/bugs/a.md\tissues/closed/bugs/a.md"]);

  await t.checkThrows(() => moveDoc({ repoRoot: root, from: "issues/bugs/taken.md", to: "issues/closed/bugs/", dryRun: false }), "DestinationExistsError: issues/closed/bugs/taken.md: destination already exists");
  t.check(fs.existsSync(path.join(root, "issues/bugs/taken.md")), true);
});

// ## An ambiguous reference refuses the move before anything changes
void test("An ambiguous reference refuses the move before anything changes", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-move-"));
  t.teardown(() => fs.rmSync(root, { recursive: true, force: true }));
  repo(root, {
    "beebox/docs/plans/z.md": "plan\n",
    "docs/plans/z.md": "a root docs copy\n",
    "beebox/src/y.ts": "// see docs/plans/z.md\n",
    "beebox/src/ok.ts": "// see beebox/docs/plans/z.md\n",
  });
  await t.checkThrows(
    () => moveDoc({ repoRoot: root, from: "beebox/docs/plans/z.md", to: "beebox/docs/implemented-plans/", dryRun: false }),
    "UnsafeReferencesError: beebox/docs/plans/z.md: references that cannot be rewritten safely; make each path name one file, then rerun:\n  beebox/src/y.ts:L1: ambiguous path `docs/plans/z.md` (matches beebox/docs/plans/z.md, docs/plans/z.md); not rewritten",
  );
  t.check(git(root, "status", "--porcelain"), "");
});
