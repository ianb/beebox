# Box file watcher — directory watches, not file watches

`ensureBoxWatcher` watches a box root so agent edits surface as `file-change`
events. It watches **directories only**. That is the whole point of the module:
chokidar, which this replaced, called `fs.watch()` once per *file*, and on macOS
a file watch holds an open read descriptor for that file's whole life. A box
with ~9.4k files pinned ~9.4k FDs in `cb serve` and pushed the process past
macOS's legacy per-process `OPEN_MAX` of 10240 — past which *every* `spawn()`
fails with `EBADF`, so the chat agent could not start at all
(`issues/bugs/2026-08-03-intermittent-spawn-ebadf-sdk-chat-run.md`).

```ts setup
import { ensureBoxWatcher, closeBoxWatcher } from "../../../src/core/box/file-watcher.js";
import { createEventBus } from "../../../src/core/event-bus.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { mkdir, writeFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** How many descriptors this process holds right now. */
const openFDs = () => readdirSync("/dev/fd").length;

/** Seed `count` files spread over `dirs` directories under the box root. */
async function seedTree(root: string, dirs: number, perDir: number): Promise<void> {
  for (let d = 0; d < dirs; d++) {
    const dir = join(root, "store", `dir${d}`);
    await mkdir(dir, { recursive: true });
    for (let f = 0; f < perDir; f++) {
      await writeFile(join(dir, `card${f}.memo.card`), "---\nstatus: new\n---\nbody\n");
    }
  }
}
```

## One watch per directory — never one per file

The watched set is exactly the box's directories. This is the platform-independent
statement of the fix: against chokidar this list would also carry all 400 card
files.

```ts
const box = await makeTmpBox();
const bus = createEventBus(box.root, { pollInterval: 60_000 });
await seedTree(box.root, 4, 100);

const watcher = ensureBoxWatcher(box.root, bus);
await watcher.ready;

watcher.watchedDirs().join(" ")
=> . store store/dir0 store/dir1 store/dir2 store/dir3
```

```ts cleanup
await closeBoxWatcher(box.root);
bus.close();
await box.cleanup();
```

## Watching 400 files costs a handful of descriptors, not 400

The direct statement of the bug. On macOS this assertion is the one that would
have caught it: with chokidar the delta here was ~1 per file. (On Linux a watch
is an inotify registration rather than a descriptor, so the delta is near zero
either way — the watched-set assertion above is what carries the regression
there.)

```ts
const box = await makeTmpBox();
const bus = createEventBus(box.root, { pollInterval: 60_000 });
await seedTree(box.root, 4, 100);

const before = openFDs();
const watcher = ensureBoxWatcher(box.root, bus);
await watcher.ready;
const grew = openFDs() - before;

grew < 20
=> true
```

```ts cleanup
await closeBoxWatcher(box.root);
bus.close();
await box.cleanup();
```

## A write surfaces as a `file-change` carrying the box-relative path

Consumers key on `path` alone, so that is what has to be right.

```ts
const box = await makeTmpBox();
const bus = createEventBus(box.root, { pollInterval: 60_000 });
await mkdir(join(box.root, "store"), { recursive: true });

const seen: string[] = [];
bus.subscribe({ listener: (e) => { if (e.event === "file-change") seen.push(String(e.data.path)); } });

const watcher = ensureBoxWatcher(box.root, bus);
await watcher.ready;

await writeFile(join(box.root, "store", "Note.memo.card"), "---\nstatus: new\n---\nhi\n");
await new Promise((r) => setTimeout(r, 300));

seen.includes("store/Note.memo.card")
=> true
```

```ts cleanup
await closeBoxWatcher(box.root);
bus.close();
await box.cleanup();
```

## Directories created after startup are picked up

A card folder made by the agent mid-session must go live without a restart —
otherwise the "watch dirs" strategy would silently stop reporting new subtrees.

```ts
const box = await makeTmpBox();
const bus = createEventBus(box.root, { pollInterval: 60_000 });
await mkdir(join(box.root, "store"), { recursive: true });

const watcher = ensureBoxWatcher(box.root, bus);
await watcher.ready;

await mkdir(join(box.root, "store", "Trip.attach"), { recursive: true });
await new Promise((r) => setTimeout(r, 300));

watcher.watchedDirs().includes("store/Trip.attach")
=> true
```

```ts cleanup
await closeBoxWatcher(box.root);
bus.close();
await box.cleanup();
```

## High-churn trees stay excluded

`procedure/runs` and `store/trash` are never live-rendered and churn constantly;
watching them exhausted the server's inotify limit on 2026-06-11. Dotfile trees
(`.git`, `.callback-box`) are excluded for the same reason.

```ts
const box = await makeTmpBox();
const bus = createEventBus(box.root, { pollInterval: 60_000 });
await mkdir(join(box.root, "procedure", "runs", "r1"), { recursive: true });
await mkdir(join(box.root, "store", "trash", "old"), { recursive: true });
await mkdir(join(box.root, "store", "keep"), { recursive: true });

const watcher = ensureBoxWatcher(box.root, bus);
await watcher.ready;

watcher.watchedDirs().join(" ")
=> . procedure store store/keep
```

```ts cleanup
await closeBoxWatcher(box.root);
bus.close();
await box.cleanup();
```
