# The `_tmp/` sweep

`cleanupOldTmpUploads` runs from `bbx wakeup` housekeeping and removes what
the chat composer uploaded a week ago or more. Two layouts live in `_tmp/`:
files flat at the top (older clients and other scratch), each aged by its own
mtime; and one directory per chat message under `_tmp/chat/<batch>/`, aged
by its newest file and removed whole — a message's attachments go together.
Other directories belong to someone else (`_tmp/scan-quarantine/` has its
own GC) and are never touched.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { cleanupOldTmpUploads } from "../../src/core/housekeeping.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const DAY = 24 * 60 * 60 * 1000;
async function writeAged(file: string, ageDays: number) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, "x");
  const at = new Date(Date.now() - ageDays * DAY);
  await fs.utimes(file, at, at);
}
async function ageDir(dir: string, ageDays: number) {
  const at = new Date(Date.now() - ageDays * DAY);
  await fs.utimes(dir, at, at);
}
async function exists(p: string) {
  try { await fs.access(p); return true; } catch (_e) { return false; }
}
```

```ts
const box = await makeTmpBox();
const tmp = path.join(box.root, "_tmp");
await writeAged(path.join(tmp, "old-flat.pdf"), 9);
await writeAged(path.join(tmp, "fresh-flat.pdf"), 1);
// A stale batch: every file over a week old.
await writeAged(path.join(tmp, "chat/stale-batch-01/IMG_0001.jpg"), 10);
await writeAged(path.join(tmp, "chat/stale-batch-01/notes.txt"), 8);
await ageDir(path.join(tmp, "chat/stale-batch-01"), 10);
// A batch whose directory is old but which received a file yesterday stays.
await writeAged(path.join(tmp, "chat/live-batch-002/IMG_0002.jpg"), 12);
await writeAged(path.join(tmp, "chat/live-batch-002/late.txt"), 1);
await ageDir(path.join(tmp, "chat/live-batch-002"), 12);
// An empty batch directory ages by its own mtime.
await fs.mkdir(path.join(tmp, "chat/empty-batch-03"), { recursive: true });
await ageDir(path.join(tmp, "chat/empty-batch-03"), 30);
// Someone else's directory, old, is not ours to remove.
await writeAged(path.join(tmp, "scan-quarantine/old.pdf"), 40);
await ageDir(path.join(tmp, "scan-quarantine"), 40);

const log: string[] = [];
await cleanupOldTmpUploads(box.root, (m) => log.push(m))
=> 3

JSON.stringify(await Promise.all([
  exists(path.join(tmp, "old-flat.pdf")),
  exists(path.join(tmp, "fresh-flat.pdf")),
  exists(path.join(tmp, "chat/stale-batch-01")),
  exists(path.join(tmp, "chat/live-batch-002/IMG_0002.jpg")),
  exists(path.join(tmp, "chat/empty-batch-03")),
  exists(path.join(tmp, "scan-quarantine/old.pdf")),
]))
=> [false,true,false,true,false,true]

log.filter((l) => l.includes("Removed:")).map((l) => l.trim().replace(/ \(\d+ days old\)/, "")).sort().join("\n")
=> Removed: _tmp/chat/empty-batch-03/
Removed: _tmp/chat/stale-batch-01/
Removed: _tmp/old-flat.pdf
```

```ts cleanup
await box.cleanup();
```
