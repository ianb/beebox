# `validateMoveList`

```ts setup
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateMoveList } from "../../../../src/dev/layout/move/validate.js";

const execFileAsync = promisify(execFile);
const repoRoot = await mkdtemp(join(tmpdir(), "layout-move-validate-"));
async function write(rel: string, content: string) {
  const full = join(repoRoot, rel);
  await mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  await writeFile(full, content);
}
await execFileAsync("git", ["init", "-q"], { cwd: repoRoot });
await write("pkg/src/a.ts", "export const a = 1;\n");
await write("pkg/src/b.ts", "export const b = 1;\n");
await execFileAsync("git", ["add", "-A"], { cwd: repoRoot });
```

## A clean move validates and is returned as given

```ts
JSON.stringify(
  validateMoveList({ moves: [{ from: "pkg/src/a.ts", to: "pkg/src/moved.ts" }], repoRoot }),
)
=> [{"from":"pkg/src/a.ts","to":"pkg/src/moved.ts"}]
```

## A missing, untracked, or already-tracked-as-`to` source fails before anything runs

```ts
validateMoveList({ moves: [{ from: "pkg/src/missing.ts", to: "pkg/src/moved.ts" }], repoRoot })
=> throws MoveSourceMissingError

validateMoveList({ moves: [{ from: "pkg/src/a.ts", to: "pkg/src/b.ts" }], repoRoot })
=> throws MoveTargetExistsError
```

## Duplicate `from` or `to` across moves fails

```ts
validateMoveList({
  moves: [
    { from: "pkg/src/a.ts", to: "pkg/src/x.ts" },
    { from: "pkg/src/a.ts", to: "pkg/src/y.ts" },
  ],
  repoRoot,
})
=> throws DuplicateMoveSourceError

validateMoveList({
  moves: [
    { from: "pkg/src/a.ts", to: "pkg/src/x.ts" },
    { from: "pkg/src/b.ts", to: "pkg/src/x.ts" },
  ],
  repoRoot,
})
=> throws DuplicateMoveTargetError
```

## A produced-from chain (an intermediate path that doesn't exist yet) is ordered producer-first

Neither intermediate path (`temp.ts`, `final.ts`) exists yet; the second
move's `from` is produced by the first, so the first must run first.

```ts
JSON.stringify(
  validateMoveList({
    moves: [
      { from: "pkg/src/temp.ts", to: "pkg/src/final.ts" },
      { from: "pkg/src/a.ts", to: "pkg/src/temp.ts" },
    ],
    repoRoot,
  }),
)
=> [{"from":"pkg/src/a.ts","to":"pkg/src/temp.ts"},{"from":"pkg/src/temp.ts","to":"pkg/src/final.ts"}]
```

## An occupied-target chain (a `to` that is another move's `from`, both already tracked) is ordered vacator-first

`b.ts` already exists; `a.ts -> b.ts` can only run once `b.ts -> c.ts` has
vacated it, the opposite order from the produced-from case above.

```ts
JSON.stringify(
  validateMoveList({
    moves: [
      { from: "pkg/src/a.ts", to: "pkg/src/b.ts" },
      { from: "pkg/src/b.ts", to: "pkg/src/c.ts" },
    ],
    repoRoot,
  }),
)
=> [{"from":"pkg/src/b.ts","to":"pkg/src/c.ts"},{"from":"pkg/src/a.ts","to":"pkg/src/b.ts"}]
```

## A true swap (both paths already exist, each wants the other's spot) cannot be ordered

```ts
validateMoveList({
  moves: [
    { from: "pkg/src/a.ts", to: "pkg/src/b.ts" },
    { from: "pkg/src/b.ts", to: "pkg/src/a.ts" },
  ],
  repoRoot,
})
=> throws MoveChainCycleError
```

```ts cleanup
t.teardown(() => rm(repoRoot, { recursive: true, force: true }));
```
