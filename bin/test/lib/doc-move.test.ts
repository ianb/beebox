// # doc-move: move one doc and rewrite the references to it
//
// A move knows which file moved, so it rewrites only references that resolve
// to the old path — never a same-basename file elsewhere — and re-expresses
// the moved file's own links from its new directory. Test files are rewritten
// too. What it cannot settle it reports as a notice.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { moveDoc, planDocMove } from "../../lib/doc-move.js";

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
  "beebox/docs/implemented-plans/old.md": "Historical `issues/features/a.md`, linked [here](../../../issues/features/a.md).\n<a href=\"../../../issues/features/a.md\">a</a>\n",
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

// ## Closing an issue: own links re-depth, inbound links follow, look-alikes stay
void test("Closing an issue: own links re-depth, inbound links follow, look-alikes stay", async (t) => {
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
    ["beebox/test/x.test.ts", "public", ["L1 path issues/features/a.md:L3 -> issues/closed/features/a.md:L3"]],
    ["bin/lib/x.sh", "public", ["L1 path issues/features/a.md -> issues/closed/features/a.md"]],
    ["beebox/docs/plans/p.md", "public", [
      "L6 link ../../../issues/features/a.md -> ../../../issues/closed/features/a.md",
      "L8 path issues/features/a.md -> issues/closed/features/a.md",
      "L10 link ../../../issues/features/a.md -> ../../../issues/closed/features/a.md",
    ]],
    // Historical records keep their backticked paths; their links still follow.
    ["beebox/docs/implemented-plans/old.md", "public", ["L1 link ../../../issues/features/a.md -> ../../../issues/closed/features/a.md"]],
    ["private-issues/bugs/q.md", "private", ["L1 link ../../issues/features/a.md -> ../../issues/closed/features/a.md"]],
  ]);
  t.check(p.files.find((f) => f.path === "beebox/test/x.test.ts")?.content,
    "// Fixture from issues/closed/features/a.md:L3, and issues/watch/a.md stays.\n");
  // An HTML href is not parsed; it is reported, never silently left.
  t.check(p.notices, [
    { path: "issues/closed/features/a.md", line: null, message: "own link to a missing file: issues/bugs/gone.md" },
    { path: "beebox/docs/implemented-plans/old.md", line: 2, message: "still names the old path: ../../../issues/features/a.md" },
  ]);
});

// ## A path token two files could answer to is reported, not rewritten
void test("A path token two files could answer to is reported, not rewritten", async (t) => {
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
  t.check(p.notices.map((n) => n.message), [
    "ambiguous path `docs/plans/z.md` (matches beebox/docs/plans/z.md, docs/plans/z.md); not rewritten",
    "still names the old path: docs/plans/z.md",
  ]);
});

// ## moveDoc runs git mv, writes the rewrites, and refuses an existing destination
void test("moveDoc runs git mv, writes the rewrites, and refuses an existing destination", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-move-"));
  t.teardown(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel: string, content: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  write("issues/bugs/a.md", "See [b](b.md).\n");
  write("issues/bugs/b.md", "See [a](a.md).\n");
  write("issues/closed/bugs/taken.md", "x\n");
  write("issues/bugs/taken.md", "y\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });

  moveDoc({ repoRoot: root, from: "issues/bugs/a.md", to: "issues/closed/bugs/", dryRun: false });
  t.check(fs.readFileSync(path.join(root, "issues/closed/bugs/a.md"), "utf8"), "See [b](../../bugs/b.md).\n");
  t.check(fs.readFileSync(path.join(root, "issues/bugs/b.md"), "utf8"), "See [a](../closed/bugs/a.md).\n");
  // The index holds the rename: a.md left issues/bugs/ for issues/closed/bugs/.
  t.check(execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }), "issues/bugs/b.md\nissues/bugs/taken.md\nissues/closed/bugs/a.md\nissues/closed/bugs/taken.md\n");

  await t.checkThrows(() => moveDoc({ repoRoot: root, from: "issues/bugs/taken.md", to: "issues/closed/bugs/", dryRun: false }), "DestinationExistsError: issues/closed/bugs/taken.md: destination already exists");
  t.check(fs.existsSync(path.join(root, "issues/bugs/taken.md")), true);
});
