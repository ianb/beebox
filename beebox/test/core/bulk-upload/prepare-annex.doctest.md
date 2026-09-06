# A bulk batch's blobs reach the annex

`prepareBulkBatch` writes a batch-local `.gitattributes` (`* annex.largefiles=anything`)
so a batch's arbitrary file types are annexed rather than committed as bytes.
That file is only half the mechanism: `annex.largefiles` is consulted for a path
only if `.git/info/attributes` routes it to the filter-process at all, and that
file is scoped to the asset extensions. `BULK_BATCH_ATTACH_PATTERN` is the line
that puts a batch scope on the filter's path.

This runs a **real** git-annex repository. The sibling `prepare.doctest.md` can
only prove a blob was *tracked*, which is equally true when its raw bytes were
committed — the exact failure this file exists to catch. Between 2026-08-04 and
2026-08-18 a batch's `.zip` committed as a raw blob while its photos annexed,
and no test in either tier could see it. Where git-annex is not installed the
assertions degrade to a recorded skip rather than a false pass.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { assetAnnexAttributes, assetLargefilesExpression } from "../../../src/lib/asset-extensions.js";
import { createStagingSession, addFile } from "../../../src/core/capture/staging-store.js";
import { prepareBulkBatch } from "../../../src/core/bulk-upload/prepare.js";

function hasAnnex(): boolean {
  try {
    execFileSync("git", ["annex", "version"], { stdio: "pipe" });
    return true;
  } catch (_e) {
    /* ignore: absence is the answer */
    return false;
  }
}

const ANNEX = hasAnnex();

/** A box already converted to git-annex, configured the way `bbx doctor annex` leaves one. */
async function makeAnnexBox(): Promise<{ repo: string; box: string }> {
  const repo = await mkdtemp(path.join(tmpdir(), "bbx-bulk-annex-"));
  const box = path.join(repo, "content");
  await fs.mkdir(box, { recursive: true });
  await fs.mkdir(path.join(box, ".beebox"), { recursive: true });
  await fs.writeFile(path.join(box, ".beebox/box.json"), JSON.stringify({ shapeVersion: 2 }));
  await fs.writeFile(path.join(repo, "package.json"), JSON.stringify({ name: "b", dependencies: { "beebox": "*" } }));
  execFileSync("git", ["init", "-q", "."], { cwd: repo });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repo });
  execFileSync("git", ["annex", "init", "-q", "test"], { cwd: repo });
  execFileSync("git", ["annex", "config", "--set", "annex.largefiles", assetLargefilesExpression()], { cwd: repo, stdio: "pipe" });
  await fs.writeFile(path.join(repo, ".git", "info", "attributes"), assetAnnexAttributes());
  return { repo, box };
}

/** git-annex marks object files read-only, so chmod before rm. */
async function cleanup(repo: string): Promise<void> {
  try {
    execFileSync("chmod", ["-R", "u+w", repo], { stdio: "pipe" });
  } catch (_e) {
    /* ignore: best-effort; rm reports anything that actually matters */
  }
  await fs.rm(repo, { recursive: true, force: true });
}

/** Stage one bulk session holding every file type a batch can land. */
async function stageMixedBatch(boxRoot: string): Promise<string> {
  const names = ["plain.jpg", "Mixed.Jpg", "archive.zip", "noext"];
  const staged = await createStagingSession({
    boxRoot, targetSessionId: null, createdBy: null, kind: "bulk",
    expectedItems: names.map((name, i) => ({ id: `i${i}`, name })),
  });
  for (const [i, name] of names.entries()) {
    await addFile({
      boxRoot, id: staged.id, filename: `staged-${i}.bin`, uploadedAt: "2026-08-18T12:00:00.000Z",
      originalName: name, mimeType: "application/octet-stream", itemId: `i${i}`,
      buffer: Buffer.alloc(200_000, 0x42),
    });
  }
  return staged.id;
}

/** ANNEXED / in-git for each committed path in the batch's attach scope. */
function classify(repo: string, attachRelDir: string): string {
  return execFileSync("git", ["ls-files", `content/${attachRelDir}`], { cwd: repo })
    .toString().trim().split("\n")
    .map((f) => {
      const blob = execFileSync("git", ["cat-file", "-p", `HEAD:${f}`], { cwd: repo }).toString();
      return `${path.basename(f)} ${blob.startsWith("/annex/objects/") ? "ANNEXED" : "in-git"}`;
    })
    .sort().join("\n");
}
```

## Every blob is annexed; the control files stay readable text

A batch of four 200 KB files: an ordinary photo, the same extension in mixed
case, a `.zip` no asset allowlist covers, and a file with no extension at all.
All four are content the box must not carry in git's object database. The card
and the batch's own `.gitattributes` have to stay in git — an annexed
`.gitattributes` would be a pointer where git expects rules.

```ts
const { repo, box } = await makeAnnexBox();
const id = await stageMixedBatch(box);
const batch = await prepareBulkBatch({ boxRoot: box, id, contextDir: "" });
ANNEX ? classify(repo, batch.attachRelDir) : "skipped: git-annex not installed"
=>
.gitattributes in-git
Mixed.Jpg ANNEXED
archive.zip ANNEXED
noext ANNEXED
plain.jpg ANNEXED
```

The pointers stand in for real bytes: nothing 200 KB is in the commit.

```ts continue
const sizes = execFileSync("git", ["ls-tree", "-r", "-l", "HEAD", "--", `content/${batch.attachRelDir}`], { cwd: repo })
  .toString().trim().split("\n").map((l) => Number(l.split(/\s+/)[3]));
ANNEX ? Math.max(...sizes) < 4000 : true
=> true
```

```ts cleanup
await cleanup(repo);
```
