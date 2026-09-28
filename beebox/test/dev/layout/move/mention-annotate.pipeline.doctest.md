# `--annotate-from-git`: annotating old-path mentions left alone by rewrite

Same fixture style as `git-renames.pipeline.doctest.md` and
`mention-rewrite.pipeline.doctest.md`: a real temp git repo, moves composed
from git's own rename detection between a base commit and `HEAD`, then
`computeMentionAnnotate` over it. Unlike `--mentions-from-git`, this mode
never rewrites the old path — it appends a `(moved to \`...\`)` note after it.

```ts setup
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { computeMentionAnnotate } from "../../../../src/dev/layout/move/mention-annotate.js";
import { scanRoots } from "../../../../src/dev/layout/move/roots.js";

const execFileAsync = promisify(execFile);
const repoRoot = await mkdtemp(join(tmpdir(), "layout-move-annotate-pipeline-"));
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
await git(["config", "user.email", "test@example.com"]);
await git(["config", "user.name", "Test"]);

await write("pkg/package.json", JSON.stringify({ name: "pkg" }));
await write("pkg/src/a.ts", "export const a = 1;\n");
await write("pkg/lib/util.ts", "export const util = 1;\n");
// A second package whose own move shares the SAME package-relative token
// ("src/a.ts") as pkg's — used below to prove a cross-package annotation is
// skipped when the token is ambiguous between two packages' old paths.
await write("pkg2/package.json", JSON.stringify({ name: "pkg2" }));
await write("pkg2/src/a.ts", "export const a = 2;\n");
await git(["add", "-A"]);
await git(["commit", "-q", "-m", "base"]);
const base = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).stdout.trim();

await mkdir(join(repoRoot, "pkg/src/sub"), { recursive: true });
await git(["mv", "pkg/src/a.ts", "pkg/src/sub/a.ts"]);
await mkdir(join(repoRoot, "pkg/lib/sub"), { recursive: true });
await git(["mv", "pkg/lib/util.ts", "pkg/lib/sub/util.ts"]);
await git(["mv", "pkg2/src/a.ts", "pkg2/src/moved.ts"]);
await git(["commit", "-q", "-m", "move"]);

const roots = scanRoots(repoRoot);
```

## A backtick span with a `:line-line` suffix is annotated after the closing backtick

```ts
await write("docs/note.md", "See `pkg/src/a.ts:200-211` for the old code.\n");
await git(["add", "-A"]);
let { result } = computeMentionAnnotate({ repoRoot, base, roots });
result.fileEdits.get("docs/note.md")
=> See `pkg/src/a.ts:200-211` (moved to `pkg/src/sub/a.ts`) for the old code.

await read("docs/note.md")
=> See `pkg/src/a.ts:200-211` for the old code.
```

## A Markdown link is annotated after the closing `)`

```ts continue
await write("docs/link.md", "See [the old file](pkg/src/a.ts) for context.\n");
await git(["add", "-A"]);
({ result } = computeMentionAnnotate({ repoRoot, base, roots }));
result.fileEdits.get("docs/link.md")
=> See [the old file](pkg/src/a.ts) (moved to `pkg/src/sub/a.ts`) for context.
```

## A table cell keeps the note in the cell

```ts continue
await write("docs/table.md", "| path | note |\n| --- | --- |\n| pkg/src/a.ts | legacy |\n");
await git(["add", "-A"]);
({ result } = computeMentionAnnotate({ repoRoot, base, roots }));
result.fileEdits.get("docs/table.md")
=> | path | note |
| --- | --- |
| pkg/src/a.ts (moved to `pkg/src/sub/a.ts`) | legacy |
```

## A fenced code block is skipped entirely, so the runnable example stays intact

Uses a `~~~` fence for the fixture's own inner block so it doesn't collide
with this doctest's own ` ``` ` delimiters.

```ts continue
await write("docs/fenced.md", "Prose mentions pkg/src/a.ts here.\n~~~ts\nimport x from \"pkg/src/a.ts\";\n~~~\n");
await git(["add", "-A"]);
({ result } = computeMentionAnnotate({ repoRoot, base, roots }));
result.fileEdits.get("docs/fenced.md")
=> Prose mentions pkg/src/a.ts (moved to `pkg/src/sub/a.ts`) here.
~~~ts
import x from "pkg/src/a.ts";
~~~
```

## Idempotent: a mention already annotated is left alone

```ts continue
await write("docs/already.md", "See pkg/src/a.ts (moved to `pkg/src/sub/a.ts`) already.\n");
await git(["add", "-A"]);
({ result } = computeMentionAnnotate({ repoRoot, base, roots }));
result.fileEdits.has("docs/already.md")
=> false
```

## A frozen prefix (`beebox/docs/reports/`) is never annotated

```ts continue
await write("beebox/docs/reports/old.md", "See pkg/src/a.ts in the snapshot.\n");
await git(["add", "-A"]);
({ result } = computeMentionAnnotate({ repoRoot, base, roots }));
result.fileEdits.has("beebox/docs/reports/old.md")
=> false
```

## A package-relative mention is scoped to files inside that package

```ts continue
await write("pkg/README.md", "Implementation: src/a.ts\n");
await write("other-pkg/README.md", "Compare to src/a.ts in pkg.\n");
await git(["add", "-A"]);
({ result } = computeMentionAnnotate({ repoRoot, base, roots }));
result.fileEdits.get("pkg/README.md")
=> Implementation: src/a.ts (moved to `pkg/src/sub/a.ts`)

result.fileEdits.has("other-pkg/README.md")
=> false
```

## A package-relative mention outside any package is annotated when exactly one package's mapping produces it

`issues/` isn't a package (no `package.json`), so `lib/util.ts` is only
reachable through the annotation-only cross-package fallback — `pkg` is the
only package whose move mapping produces that literal token, and no package
currently has a real file at `<root>/lib/util.ts`.

```ts continue
await write("issues/bugs/example.md", "See lib/util.ts for the old helper.\n");
await git(["add", "-A"]);
({ result } = computeMentionAnnotate({ repoRoot, base, roots }));
result.fileEdits.get("issues/bugs/example.md")
=> See lib/util.ts (moved to `pkg/lib/sub/util.ts`) for the old helper.
```

## A token shared by two packages' old paths is skipped as ambiguous

`src/a.ts` is package-relative for BOTH `pkg` (moved to `pkg/src/sub/a.ts`)
and `pkg2` (moved to `pkg2/src/moved.ts`) — from a file outside both
packages there's no way to tell which one a bare `src/a.ts` mention means,
so it's left alone rather than guessed. `other-pkg/README.md` above is the
same case (it stays unannotated for this reason too, not just because it's
outside `pkg`'s own scope).

```ts continue
await write("issues/bugs/ambiguous.md", "See src/a.ts for the old shared helper.\n");
await git(["add", "-A"]);
({ result } = computeMentionAnnotate({ repoRoot, base, roots }));
result.fileEdits.has("issues/bugs/ambiguous.md")
=> false
```

## A real package with no `src/` dir (so it's not a `roots` entry) is still "a package" for the cross-package fallback

A regression found applying this for real: `personal-vibe-check/` has a
`package.json` but no `src/`, so `default-roots.ts` doesn't count it as a
`roots` entry — but its own docs use generic example paths unrelated to any
other package's moved file, and cross-package matching must not treat it as
fair game just because it's outside `roots`.

```ts continue
await write("toolkit/package.json", JSON.stringify({ name: "toolkit" }));
await write("toolkit/README.md", "Default entry: lib/util.ts\n");
await git(["add", "-A"]);
({ result } = computeMentionAnnotate({ repoRoot, base, roots }));
result.fileEdits.has("toolkit/README.md")
=> false
```

## A uniform directory rename is derived from the mapping alone (no tracked file is left under the old directory to survey)

```ts continue
await mkdir(join(repoRoot, "pkg/src/legacy"), { recursive: true });
await write("pkg/src/legacy/one.ts", "");
await write("pkg/src/legacy/two.ts", "");
await git(["add", "-A"]);
await git(["commit", "-q", "-m", "add legacy dir"]);
const dirBase = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).stdout.trim();

await mkdir(join(repoRoot, "pkg/src/modern"), { recursive: true });
await git(["mv", "pkg/src/legacy/one.ts", "pkg/src/modern/one.ts"]);
await git(["mv", "pkg/src/legacy/two.ts", "pkg/src/modern/two.ts"]);
await git(["commit", "-q", "-m", "rename legacy to modern"]);

await write("docs/dir-note.md", "See pkg/src/legacy for the old layout.\n");
await git(["add", "-A"]);
const dirResult = computeMentionAnnotate({ repoRoot, base: dirBase, roots }).result;
dirResult.fileEdits.get("docs/dir-note.md")
=> See pkg/src/legacy (moved to `pkg/src/modern`) for the old layout.
```

## A directory mention with its own trailing `/` inside a backtick span keeps the note outside the span, not wedged before the slash

A regression found while adding the mapping-based directory survey above:
the directory token match itself stops before the trailing `/` (the
boundary rule), so naively inserting right there splits the closing
backtick — corrupting the code span with a nested, unbalanced backtick.

```ts continue
await write("docs/dir-span.md", "See `pkg/src/legacy/` for the old layout.\n");
await git(["add", "-A"]);
const dirSpanResult = computeMentionAnnotate({ repoRoot, base: dirBase, roots }).result;
dirSpanResult.fileEdits.get("docs/dir-span.md")
=> See `pkg/src/legacy/` (moved to `pkg/src/modern`) for the old layout.
```

## `--dry-run` computes the same edits without writing to disk (`computeMentionAnnotate` never writes)

```ts continue
await read("docs/note.md")
=> See `pkg/src/a.ts:200-211` for the old code.
```

## Counts: per-area totals

```ts continue
const areaResult = computeMentionAnnotate({ repoRoot, base, roots }).result;
areaResult.total >= 1
=> true

[...areaResult.countsByArea.keys()].every((k) => ["plans", "implemented-plans", "issues-closed", "issues-open", "research", "other"].includes(k))
=> true
```

```ts cleanup
t.teardown(() => rm(repoRoot, { recursive: true, force: true }));
```
