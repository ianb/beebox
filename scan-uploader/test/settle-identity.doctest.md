# Settle gate and file identity

Two independent defenses against a scanner writing a file out from under the
uploader: the **settle gate** (skip files touched too recently) before the
first hash, and **identity snapshot + restat-before-disposition** (see
run-target.doctest.md) after it.

```ts setup
import { utimes, writeFile } from "node:fs/promises";

import { isSettled, SETTLE_WINDOW_MS } from "../src/settle.js";
import { identityEquals, snapshotIdentity } from "../src/identity.js";
import { makeTmpDir, removeTmpDir } from "./tmp-dir.js";

const dir = await makeTmpDir("settle");
```

A file just written is not settled — its mtime is within the 10s window:

```
const fresh = `${dir}/fresh.pdf`;
await writeFile(fresh, "scan bytes");
await isSettled(fresh, Date.now())
=> false
```

A file whose mtime is safely in the past IS settled:

```
const old = `${dir}/old.pdf`;
await writeFile(old, "scan bytes");
const oldMtime = new Date(Date.now() - SETTLE_WINDOW_MS - 1000);
await utimes(old, oldMtime, oldMtime);
await isSettled(old, Date.now())
=> true
```

The boundary is inclusive of "now minus the window" — exactly at the window
edge counts as settled (`>=`, not `>`):

```
const boundary = `${dir}/boundary.pdf`;
await writeFile(boundary, "scan bytes");
const now = Date.now();
const boundaryMtime = new Date(now - SETTLE_WINDOW_MS);
await utimes(boundary, boundaryMtime, boundaryMtime);
await isSettled(boundary, now)
=> true
```

`snapshotIdentity` captures device, inode, size, and nanosecond mtime.
Re-snapshotting an untouched file yields an identical snapshot:

```
const stable = `${dir}/stable.pdf`;
await writeFile(stable, "unchanged bytes");
const first = await snapshotIdentity(stable);
const second = await snapshotIdentity(stable);
identityEquals(first, second)
=> true
```

Appending to the file (same path, different bytes) changes its identity —
this is the signal `run-target.ts` checks before disposition:

```continue
const before = await snapshotIdentity(stable);
await writeFile(stable, "unchanged bytes and then some more");
const after = await snapshotIdentity(stable);
identityEquals(before, after)
=> false
```

```cleanup
await removeTmpDir(dir);
```
