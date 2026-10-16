# Changed-path detection does not re-clean unchanged annexed files

A docs refresh once kept a large box closed for about ten minutes: computing
the migration's changed paths sent every annexed file back through
`git-annex filter-process`, because the temporary index lost its cached stat
data. Unchanged files must keep that stat data, so only files whose bytes may
differ go through the clean filter.

```ts setup
import { execFileSync } from "node:child_process";
import { readFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { captureMigrationSnapshot, changedMigrationPaths } from "../../src/core/migration-recovery.js";
function git(box, ...args) {
  return execFileSync("git", args, { cwd: box.root, encoding: "utf8" }).trim();
}
// Each request git sends to a long-running filter names its path; count those.
async function cleanedPaths(box, fn) {
  const trace = join(box.root, ".git", "packet-trace");
  process.env.GIT_TRACE_PACKET = trace;
  try {
    const result = await fn();
    const log = await readFile(trace, "utf8").catch(() => "");
    const paths = [...log.matchAll(/> pathname=(.*)$/gm)].map((m) => m[1]);
    return { result, cleaned: [...new Set(paths)].sort() };
  } finally {
    delete process.env.GIT_TRACE_PACKET;
  }
}
```

Three annexed photos are committed, then backdated so Git trusts their cached
stat data. The migration rewrites one photo and adds a note.

```ts
const box = await makeTmpBox({ git: true });
for (const name of ["a", "b", "c"]) await box.write(`_assets/${name}.jpg`, `photo ${name}\n`);
box.commitAll("photos");
const past = new Date("2026-01-01T00:00:00Z");
for (const name of ["a", "b", "c"]) await utimes(box.path(`_assets/${name}.jpg`), past, past);
git(box, "update-index", "--refresh");
git(box, "check-attr", "filter", "_assets/a.jpg")
=> _assets/a.jpg: filter: annex

const snapshot = await captureMigrationSnapshot(box.root, "fixture");
await box.write("_assets/b.jpg", "photo b, migrated\n");
await box.write("note.md", "new note\n");
await cleanedPaths(box, () => changedMigrationPaths(box.root, snapshot))
=> { result: ["_assets/b.jpg", "note.md"], cleaned: ["_assets/b.jpg"] }
```

The changed paths are the same ones a full re-read would report. A deleted
photo counts as changed. A file that was untracked in the snapshot and is now
ignored stays in the comparison, so it does not read as deleted.

```ts continue
await box.write("scratch.txt", "draft\n");
const second = await captureMigrationSnapshot(box.root, "fixture");
await box.write(".gitignore", `${await box.read(".gitignore")}scratch.txt\n`);
git(box, "rm", "--quiet", "--cached", "_assets/c.jpg");
execFileSync("rm", [box.path("_assets/c.jpg")]);
(await changedMigrationPaths(box.root, second)).sort()
=> [".gitignore", "_assets/c.jpg"]
```

An unmerged index cannot keep stat data, so the comparison falls back to a
full re-read rather than failing.

```ts continue
const blob = git(box, "rev-parse", "HEAD:_assets/a.jpg");
execFileSync("git", ["update-index", "--index-info"], { cwd: box.root, input: `0 ${"0".repeat(40)}\t_assets/a.jpg\n100644 ${blob} 1\t_assets/a.jpg\n100644 ${blob} 2\t_assets/a.jpg\n` });
(await changedMigrationPaths(box.root, second)).sort()
=> [".gitignore", "_assets/c.jpg"]
```

A file marked assume-unchanged would keep that mark through the stat-keeping
read and be skipped, so a flagged index also reads fresh and the migrated
file is reported. The merge is resolved first, so only the flag differs.

```ts continue
git(box, "reset", "--quiet", "--", "_assets/a.jpg");
git(box, "update-index", "--assume-unchanged", "_assets/a.jpg");
await box.write("_assets/a.jpg", "photo a, migrated\n");
(await changedMigrationPaths(box.root, second)).sort()
=> [".gitignore", "_assets/a.jpg", "_assets/c.jpg"]
```

```ts cleanup
await box.cleanup();
```
