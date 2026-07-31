# Unlisted binaries in attach scopes

`ASSET_EXTENSIONS` is an allowlist, and an allowlist's failure mode is
omission — a new binary type lands in an attach scope, matches nothing, and its
bytes go into git history. That is how 41 MB `page.frozen` snapshots got
committed before 2026-07-19. This scan makes the next omission loud. See
`src/core/annex/unlisted-binaries.ts`.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import {
  findUnlistedBinaries,
  describeUnlistedBinaries,
  UNLISTED_BINARY_LIMIT_BYTES,
} from "../../../src/core/annex/unlisted-binaries.js";

/** Write a file of `size` bytes into a scope, creating the scope. */
async function put(root: string, relPath: string, size: number): Promise<void> {
  const abs = path.join(root, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, Buffer.alloc(size, 7));
}

const BIG = UNLISTED_BINARY_LIMIT_BYTES + 1;
```

A large unlisted file is reported. This is the `.frozen` case: nothing about
`.parquet` is in the allowlist, so `git add` would commit its bytes directly.

```ts
const box = await makeTmpBox();
await put(box.root, "notes.attach/export.parquet", BIG);
const found = await findUnlistedBinaries(box.root);
found.map((f) => `${f.relPath} .${f.extension}`).join(", ")
=> notes.attach/export.parquet .parquet
```

Listed asset types are not reported at any size — they will be annexed, which
is the whole point:

```ts continue
await put(box.root, "notes.attach/photo.jpg", BIG);
await put(box.root, "notes.attach/scan.pdf", BIG);
(await findUnlistedBinaries(box.root)).length
=> 1
```

Small unlisted files are ignored. Attach scopes legitimately hold committed
text — cards, manifests, email bodies, `.csv` exports — and flagging those
would train everyone to ignore the check:

```ts continue
await put(box.root, "notes.attach/accounts.csv", 58 * 1024);
await put(box.root, "notes.attach/msg-001.body.txt", 2000);
(await findUnlistedBinaries(box.root)).length
=> 1
```

Control files are skipped regardless of size — a card or manifest belongs in
git no matter how large it grows:

```ts continue
await put(box.root, "notes.attach/photo-001.image.card", BIG);
await put(box.root, "notes.attach/manifest.json", BIG);
(await findUnlistedBinaries(box.root)).length
=> 1
```

The report names both remedies, since which one is right is a judgment the
reader has to make:

```ts continue
const report = describeUnlistedBinaries(await findUnlistedBinaries(box.root));
report.includes("Either add the extension to ASSET_EXTENSIONS") && report.includes("or confirm the file belongs in git")
=> true
```

```ts cleanup
await box.cleanup();
```

A box with no attach scopes at all scans clean rather than erroring:

```ts
const empty = await makeTmpBox();
(await findUnlistedBinaries(empty.root)).length
=> 0

await empty.cleanup();
```
