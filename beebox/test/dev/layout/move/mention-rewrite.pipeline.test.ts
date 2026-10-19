// # `computeMentionRewrite`: end-to-end mention rewriting over a real temp git repo
//
// Same fixture style as `apply.pipeline.test.ts`, exercising `mention-rewrite.ts`
// directly rather than through the CLI (pure computation — nothing here writes
// to disk; the CLI decides whether to persist `fileEdits`, so this is exactly
// what a `--dry-run` would compute too).

import { test } from "tap";
import "agent-doctest/tap";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { computeMentionRewrite } from "../../../../src/dev/layout/move/mention-rewrite.js";
import { scanRoots } from "../../../../src/dev/layout/move/roots.js";

const execFileAsync = promisify(execFile);
const repoRoot = await mkdtemp(join(tmpdir(), "layout-move-mention-pipeline-"));
async function write(rel: string, content: string) {
  const full = join(repoRoot, rel);
  await mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  await writeFile(full, content);
}
async function read(rel: string): Promise<string> {
  return readFile(join(repoRoot, rel), "utf8");
}
async function git(args: string[]) {
  await execFileAsync("git", args, { cwd: repoRoot });
}
await git(["init", "-q"]);

await write("pkg/package.json", JSON.stringify({ name: "pkg" }));
await write("pkg/tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: "." } }));
await write("pkg/src/a.ts", "export const a = 1;\n");
// repo-relative mention, in a doc outside the package.
await write("docs/note.md", "See pkg/src/a.ts for details.\n");
// package-relative mention, in a file inside the package (in scope).
await write("pkg/README.md", "Implementation: src/a.ts\n");
// package-relative mention, in a file OUTSIDE the package (out of scope: left for review).
await write("other-pkg/README.md", "Compare to src/a.ts in pkg.\n");
// A relative-form mention (form 4) in a non-TS file.
await write("pkg/scripts/run.sh", "# see ../src/a.ts\n");
// knip.ts with two per-package workspace blocks sharing the same relative entry text.
await write(
  "knip.ts",
  'export default {\n  workspaces: {\n    "pkg": {\n      entry: ["src/a.ts"],\n    },\n    "other-pkg": {\n      entry: ["src/a.ts"],\n    },\n  },\n};\n',
);
// A history doc: keeps the old path on purpose, excluded from rewrite AND review.
await write("beebox/docs/plans/old.md", "Filed against pkg/src/a.ts.\n");
// scratch/: excluded the same way.
await write("scratch/note.md", "pkg/src/a.ts\n");
await git(["add", "-A"]);

const moves = [{ from: "pkg/src/a.ts", to: "pkg/src/sub/a.ts" }];
const roots = scanRoots(repoRoot);
const result = computeMentionRewrite({ repoRoot, moves, roots, rewrittenFiles: new Set() });

// ## Nothing is written to disk — `computeMentionRewrite` only returns in-memory edits
void test("Nothing is written to disk — `computeMentionRewrite` only returns in-memory edits", async (t) => {
  await t.checkText(await read("docs/note.md"), "See pkg/src/a.ts for details.");
});

const knipRewritten = `export default {
  workspaces: {
    "pkg": {
      entry: ["src/sub/a.ts"],
    },
    "other-pkg": {
      entry: ["src/a.ts"],
    },
  },
};
`;

// ## The repo-relative form rewrites the doc outside the package
void test("The repo-relative form rewrites the doc outside the package", async (t) => {
  t.check(result.fileEdits.get("docs/note.md"), "See pkg/src/sub/a.ts for details.\n");
});

// ## The package-relative form rewrites the in-scope file, but leaves the out-of-scope file for review
void test("The package-relative form rewrites the in-scope file, but leaves the out-of-scope file for review", async (t) => {
  t.check(result.fileEdits.get("pkg/README.md"), "Implementation: src/sub/a.ts\n");

  // Whole map: no entry for other-pkg/README.md.
  t.check(result.fileEdits, new Map([
    ["docs/note.md", "See pkg/src/sub/a.ts for details.\n"],
    ["knip.ts", knipRewritten],
    ["pkg/README.md", "Implementation: src/sub/a.ts\n"],
    ["pkg/scripts/run.sh", "# see ../src/sub/a.ts\n"],
  ]));
});

// ## `knip.ts`'s package-relative rewrite is scoped to the moved file's own workspace block, not the other package's identical-looking entry
void test("`knip.ts`'s package-relative rewrite is scoped to the moved file's own workspace block, not the other package's identical-looking entry", async (t) => {
  t.check(result.fileEdits.get("knip.ts"), knipRewritten);
});

// ## The relative form (form 4) rewrites the shell script's own-directory-relative mention
void test("The relative form (form 4) rewrites the shell script's own-directory-relative mention", async (t) => {
  t.check(result.fileEdits.get("pkg/scripts/run.sh"), "# see ../src/sub/a.ts\n");
});

// ## History docs and `scratch/` keep the old path — excluded from rewrite AND from "needs review"
void test("History docs and `scratch/` keep the old path — excluded from rewrite AND from \"needs review\"", async (t) => {
  t.check([...result.fileEdits.keys()], ["docs/note.md", "knip.ts", "pkg/README.md", "pkg/scripts/run.sh"]);

  // The out-of-scope package-relative mention (other-pkg/README.md) and the second knip.ts
  // block surface in needsReview; the history doc and scratch/ do not.
  t.check(result.needsReview, [
    {
      movedPath: "pkg/src/a.ts",
      lines: [
        "knip.ts:7:      entry: [\"src/a.ts\"],",
        "other-pkg/README.md:1:Compare to src/a.ts in pkg.",
      ],
    },
  ]);
});

// ## The out-of-scope package-relative mention surfaces in "needs review" instead of being silently dropped
void test("The out-of-scope package-relative mention surfaces in \"needs review\" instead of being silently dropped", async (t) => {
  t.check(result.needsReview.find((g) => g.movedPath === "pkg/src/a.ts")?.lines, [
    "knip.ts:7:      entry: [\"src/a.ts\"],",
    "other-pkg/README.md:1:Compare to src/a.ts in pkg.",
  ]);
});

// ## Counts: one hit per form
void test("Counts: one hit per form", async (t) => {
  t.check(Object.fromEntries(result.countsByForm), {
    "repo-relative": 1,
    "package-relative": 2,
    relative: 1,
  });
});

// ## A uniform directory rename is rewritten; a directory glob that shares its text is reported, not rewritten
void test("A uniform directory rename is rewritten; a directory glob that shares its text is reported, not rewritten", async (t) => {
  t.teardown(() => rm(repoRoot, { recursive: true, force: true }));
  await write("pkg/src/legacy/one.ts", "");
  await write("pkg/src/legacy/two.ts", "");
  await write("pkg/docs/dir-note.md", "See pkg/src/legacy for the old layout.\n");
  await write("pkg/eslint.config.ts", 'export default [{ files: ["pkg/src/legacy/**/*.ts"] }];\n');
  await git(["add", "-A"]);

  const dirMoves = [
    { from: "pkg/src/legacy/one.ts", to: "pkg/src/modern/one.ts" },
    { from: "pkg/src/legacy/two.ts", to: "pkg/src/modern/two.ts" },
  ];
  const dirResult = computeMentionRewrite({ repoRoot, moves: dirMoves, roots, rewrittenFiles: new Set() });

  // The eslint config shares the directory text but is reported, not rewritten.
  t.check(dirResult.fileEdits, new Map([["pkg/docs/dir-note.md", "See pkg/src/modern for the old layout.\n"]]));

  t.check(dirResult.needsReview, [
    { movedPath: "pkg/src/legacy/one.ts", lines: [] },
    { movedPath: "pkg/src/legacy/two.ts", lines: [] },
    { movedPath: "pkg/src/legacy/", lines: ['pkg/eslint.config.ts:1:export default [{ files: ["pkg/src/legacy/**/*.ts"] }];'] },
  ]);
});
