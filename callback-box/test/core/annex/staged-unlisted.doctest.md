# Staged unlisted binaries (the commit-time guard)

The pre-commit guard reads the **index**, not the tree: bytes enter history only
via staged blobs, so this fires at exactly the commit that would embed them and
scales with the commit rather than the box. The box-wide walk
(`unlisted-binaries.ts`) stays for `cb doctor annex` / `attachments verify`. See
`src/core/annex/staged-unlisted.ts`.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import {
  findStagedUnlistedBinaries,
  describeStagedUnlistedBinaries,
} from "../../../src/core/annex/staged-unlisted.js";
import { UNLISTED_BINARY_LIMIT_BYTES } from "../../../src/core/annex/unlisted-binaries.js";

/** Write a file of `size` bytes into the box, creating parent dirs. */
async function put(root: string, relPath: string, size: number): Promise<void> {
  const abs = path.join(root, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, Buffer.alloc(size, 7));
}

const BIG = UNLISTED_BINARY_LIMIT_BYTES + 1;
```

A large unlisted file sitting in an attach scope is invisible to this check
until it is **staged** — that is the whole point of moving off the tree walk:
pre-existing debris stops blocking unrelated commits.

```ts
const box = await makeTmpBox({ git: true });
await put(box.root, "notes.attach/export.parquet", BIG);
(await findStagedUnlistedBinaries(box.root)).length
=> 0
```

Staging it makes it a blocking finding:

```ts continue
execSync("git add -A", { cwd: box.root });
const found = await findStagedUnlistedBinaries(box.root);
found.map((f) => `${f.relPath} .${f.extension} allowlisted=${String(f.allowlisted)}`)
=>
[
  "notes.attach/export.parquet .parquet allowlisted=false"
]
```

The report names both remedies, since which one is right is a judgment the
reader has to make:

```ts continue
const report = describeStagedUnlistedBinaries(found);
[
  report.includes("Either add the extension to ASSET_EXTENSIONS"),
  report.includes("or confirm the file belongs in git"),
]
=> [
  true,
  true
]
```

Small files, control files (a card, a manifest), and files outside any attach
scope are never flagged — attach scopes legitimately hold committed text, and
flagging it would train everyone to ignore the check:

```ts continue
await put(box.root, "notes.attach/accounts.csv", 58 * 1024);
await put(box.root, "notes.attach/photo-001.image.card", BIG);
await put(box.root, "notes.attach/manifest.json", BIG);
await put(box.root, "store/dump.parquet", BIG);
execSync("git add -A", { cwd: box.root });
(await findStagedUnlistedBinaries(box.root)).map((f) => f.relPath)
=>
[
  "notes.attach/export.parquet"
]
```

A non-ASCII filename is still sized and flagged. This is what the `-z` flag in
`listStagedRelPaths` buys: without it git C-quotes such a path
(`core.quotePath`), `git cat-file` then reports the quoted name "missing", and
a large binary with a unicode name would slip through a guard that exists to
fail closed:

```ts continue
await put(box.root, "notes.attach/日記スキャン.parquet", BIG);
execSync("git add -A", { cwd: box.root });
(await findStagedUnlistedBinaries(box.root)).map((f) => f.relPath).sort()
=>
[
  "notes.attach/export.parquet",
  "notes.attach/日記スキャン.parquet"
]
```

```ts cleanup
await box.cleanup();
```

## Allowlisted extension staged as raw bytes

Sizing the staged blob rather than the working file catches a case the
extension-allowlist walk waved through: an annexed extension whose **bytes**
were staged, meaning git-annex is not filtering it. (In a correctly configured
box the staged blob is a small pointer, so a real annexed asset passes here at
any working-file size.)

```ts
const box = await makeTmpBox({ git: true });
await put(box.root, "trip.attach/beach.jpg", BIG);
execSync("git add -A", { cwd: box.root });
const found = await findStagedUnlistedBinaries(box.root);
found.map((f) => `${f.relPath} allowlisted=${String(f.allowlisted)}`)
=>
[
  "trip.attach/beach.jpg allowlisted=true"
]
```

It is reported as the misconfiguration it is, not as a missing allowlist entry:

```ts continue
const report = describeStagedUnlistedBinaries(found);
[
  report.includes("staged as RAW BYTES"),
  report.includes("cb doctor annex"),
  report.includes("Either add the extension to ASSET_EXTENSIONS"),
]
=> [
  true,
  true,
  false
]
```

```ts cleanup
await box.cleanup();
```
