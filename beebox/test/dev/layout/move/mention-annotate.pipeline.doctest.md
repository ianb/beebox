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
await git(["add", "-A"]);
await git(["commit", "-q", "-m", "base"]);
const base = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).stdout.trim();

await mkdir(join(repoRoot, "pkg/src/sub"), { recursive: true });
await git(["mv", "pkg/src/a.ts", "pkg/src/sub/a.ts"]);
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
