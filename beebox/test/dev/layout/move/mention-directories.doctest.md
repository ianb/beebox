# Detecting a directory rename hiding inside a move list

```ts setup
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { detectDirectoryRenames } from "../../../../src/dev/layout/move/mention-directories.js";

const execFileAsync = promisify(execFile);
const repoRoot = await mkdtemp(join(tmpdir(), "layout-move-mention-dirs-"));
async function write(rel: string, content: string) {
  const full = join(repoRoot, rel);
  await mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  await writeFile(full, content);
}
async function git(args: string[]) {
  await execFileAsync("git", args, { cwd: repoRoot });
}
await git(["init", "-q"]);

// Every file under `scripts/migrate` moves into `scripts/migrations` with the same suffix.
await write("scripts/migrate/one.ts", "");
await write("scripts/migrate/sub/two.ts", "");
// A sibling directory only PARTIALLY moves — one file stays.
await write("scripts/keep/a.ts", "");
await write("scripts/keep/b.ts", "");
await git(["add", "-A"]);
```

## A directory whose every tracked file moves to the same new directory with the same suffix is detected as a rename

```ts
const uniform = [
  { from: "scripts/migrate/one.ts", to: "scripts/migrations/one.ts" },
  { from: "scripts/migrate/sub/two.ts", to: "scripts/migrations/sub/two.ts" },
];
const renames = detectDirectoryRenames({ repoRoot, moves: uniform });
JSON.stringify(renames.find((r) => r.from === "scripts/migrate"))
=> {"from":"scripts/migrate","to":"scripts/migrations"}
```

## A directory with only some files moving is NOT reported as a rename (the leftover file breaks uniformity)

```ts
const partial = [{ from: "scripts/keep/a.ts", to: "scripts/kept/a.ts" }];
const partialRenames = detectDirectoryRenames({ repoRoot, moves: partial });
partialRenames.some((r) => r.from === "scripts/keep")
=> false
```

```ts cleanup
t.teardown(() => rm(repoRoot, { recursive: true, force: true }));
```
