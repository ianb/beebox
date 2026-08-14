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
import {
  ensureBoxWatcher,
  closeBoxWatcher,
  MAX_WATCHED_DIRS,
  MAX_NOTIFICATION_WORK,
  COALESCE_MS,
} from "../../../src/core/box/file-watcher.js";
import { createEventBus, type EventBus } from "../../../src/core/event-bus.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** How many descriptors this process holds right now. */
const openFDs = () => readdirSync("/dev/fd").length;

/**
 * Poll until `check` passes, up to `ms`. Filesystem notifications have no
 * latency guarantee — a fixed sleep either flakes under load or wastes time —
 * so every timing-sensitive assertion below waits for its condition.
 */
async function waitFor(check: () => boolean, ms: number, label: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !check()) {
    await new Promise((r) => setTimeout(r, 20));
  }
  if (!check()) throw new Error(`Timed out waiting for ${label}`);
}

/**
 * Prove that one directory's fs watcher is delivering before testing it.
 * Constructing `fs.watch()` has no readiness event on macOS; without this
 * handshake, an immediate write can beat FSEvents registration.
 */
async function waitForWatch(root: string, bus: EventBus, relativeDir: string): Promise<void> {
  const markerRel = join(relativeDir, `watch-ready-${process.pid}.tmp`);
  const marker = join(root, markerRel);
  let seen = false;
  const subscription = bus.subscribe({
    listener: (event) => {
      if (event.event === "file-change" && event.data.path === markerRel) seen = true;
    },
  });
  try {
    const deadline = Date.now() + 5000;
    let attempt = 0;
    while (!seen && Date.now() < deadline) {
      await writeFile(marker, String(attempt++));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (!seen) throw new Error(`Timed out waiting for fs.watch delivery in ${relativeDir}`);
  } finally {
    subscription.unsubscribe();
  }
}

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

const watcher = ensureBoxWatcher(box.root, { eventBus: bus });
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
const watcher = ensureBoxWatcher(box.root, { eventBus: bus });
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

const watcher = ensureBoxWatcher(box.root, { eventBus: bus });
await watcher.ready;
await waitForWatch(box.root, bus, "store");

await writeFile(join(box.root, "store", "Note.memo.card"), "---\nstatus: new\n---\nhi\n");
await waitFor(() => seen.includes("store/Note.memo.card"), 5000, "the card file-change event");

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

const watcher = ensureBoxWatcher(box.root, { eventBus: bus });
await watcher.ready;
await waitForWatch(box.root, bus, "store");

await mkdir(join(box.root, "store", "Trip.attach"), { recursive: true });
await waitFor(() => watcher.watchedDirs().includes("store/Trip.attach"), 5000, "the new directory watch");

watcher.watchedDirs().includes("store/Trip.attach")
=> true
```

```ts cleanup
await closeBoxWatcher(box.root);
bus.close();
await box.cleanup();
```

## A replaced directory is re-watched, subtree and all

`mv`, `git checkout`, and an atomic "write a new tree, swap it in" all replace a
directory's inode under an unchanged path. Keeping the old watches would leave
them attached to an inode that no longer exists — and, worse, make the path look
already-watched, so the new subtree would never be watched at all.

```ts
const box = await makeTmpBox();
const bus = createEventBus(box.root, { pollInterval: 60_000 });
await mkdir(join(box.root, "store", "Trip.attach", "old"), { recursive: true });

const watcher = ensureBoxWatcher(box.root, { eventBus: bus });
await watcher.ready;
await waitForWatch(box.root, bus, "store");

const { rm, rename } = await import("node:fs/promises");
await rm(join(box.root, "store", "Trip.attach"), { recursive: true });
await mkdir(join(box.root, "store", "Staging", "fresh"), { recursive: true });
await rename(join(box.root, "store", "Staging"), join(box.root, "store", "Trip.attach"));
await waitFor(() => watcher.watchedDirs().includes("store/Trip.attach/fresh"), 5000, "the replacement subtree watches");
await watcher.settled();

watcher.watchedDirs().join(" ")
=> . store store/Trip.attach store/Trip.attach/fresh
```

```ts cleanup
await closeBoxWatcher(box.root);
bus.close();
await box.cleanup();
```

## Files already inside a newly-appeared directory are announced

A directory that arrives complete — an agent writing a card folder, a `git
checkout` — held its files before any watch existed, so nothing else will ever
report them. The reconciling walk announces what it finds.

```ts
const box = await makeTmpBox();
const bus = createEventBus(box.root, { pollInterval: 60_000 });
await mkdir(join(box.root, "store"), { recursive: true });

const seen: string[] = [];
bus.subscribe({ listener: (e) => { if (e.event === "file-change") seen.push(String(e.data.path)); } });

const watcher = ensureBoxWatcher(box.root, { eventBus: bus });
await watcher.ready;
await waitForWatch(box.root, bus, "store");

// Build the tree out of sight, then swap it in whole — no watch can have seen
// the file being written.
const { rename } = await import("node:fs/promises");
await mkdir(join(box.root, "staging"), { recursive: true });
await writeFile(join(box.root, "staging", "Photo.md"), "hi\n");
await rename(join(box.root, "staging"), join(box.root, "store", "Trip.attach"));
await waitFor(() => seen.includes("store/Trip.attach/Photo.md"), 5000, "the discovered file event");
await watcher.settled();

seen.includes("store/Trip.attach/Photo.md")
=> true
```

```ts cleanup
await closeBoxWatcher(box.root);
bus.close();
await box.cleanup();
```

## A directory symlink created at runtime is not followed

The initial walk refuses symlinks (a box may link outside itself, or into
itself). The runtime path has to agree, or a link planted after startup would
pull an arbitrary outside tree into the watch set and bypass the exclusions.

```ts
const box = await makeTmpBox();
const bus = createEventBus(box.root, { pollInterval: 60_000 });
await mkdir(join(box.root, "store"), { recursive: true });
await mkdir(join(box.root, "procedure", "runs", "noisy"), { recursive: true });

const watcher = ensureBoxWatcher(box.root, { eventBus: bus });
await watcher.ready;
await waitForWatch(box.root, bus, "store");

const { symlink } = await import("node:fs/promises");
await symlink(join(box.root, "procedure", "runs"), join(box.root, "store", "link"));
// Create a real directory after the link and wait for *it*. Asserting an
// absence is only meaningful once we know the notifications arrived — a bare
// sleep would pass vacuously whenever delivery was merely slow.
await mkdir(join(box.root, "store", "real"), { recursive: true });
await waitFor(() => watcher.watchedDirs().includes("store/real"), 5000, "the real directory watch");
await watcher.settled();

watcher.watchedDirs().join(" ")
=> . procedure store store/real
```

```ts cleanup
await closeBoxWatcher(box.root);
bus.close();
await box.cleanup();
```

## Rapid writes still produce a trailing event

Repeats inside the 50 ms window collapse, but the *last* write still reaches
consumers. Merely dropping duplicates would leave a client that refetched on the
first event holding content a later write had already superseded.

The event count is deliberately not the contract: FSEvents may combine several
writes into one notification before Node sees them, especially under load.
Instead, model a consumer that refetches on each hint. First prove it observed
`v2`, then write three more versions inside the open throttle window and require
that a later hint advances the consumer all the way to `v5`.

```ts
const box = await makeTmpBox();
const bus = createEventBus(box.root, { pollInterval: 60_000 });
await mkdir(join(box.root, "store"), { recursive: true });
const card = join(box.root, "store", "Note.memo.card");
await writeFile(card, "---\nstatus: new\n---\nv1\n");

const watcher = ensureBoxWatcher(box.root, { eventBus: bus });
await watcher.ready;
await waitForWatch(box.root, bus, "store");

let events = 0;
let observed = "";
let reads = Promise.resolve();
bus.subscribe({
  listener: (e) => {
    if (e.event !== "file-change" || e.data.path !== "store/Note.memo.card") return;
    events++;
    reads = reads.then(async () => { observed = await readFile(card, "utf8"); });
  },
});

await writeFile(card, "---\nstatus: new\n---\nv2\n");
await waitFor(() => observed.endsWith("v2\n"), 5000, "the consumer to observe v2");

for (const v of ["v3", "v4", "v5"]) {
  await writeFile(card, `---\nstatus: new\n---\n${v}\n`);
}
await waitFor(() => observed.endsWith("v5\n"), 5000, "the trailing event to expose v5");
await reads;

`final content: ${observed.endsWith("v5\n")} | bounded: ${events <= 4}`
=> final content: true | bounded: true
```

```ts cleanup
await closeBoxWatcher(box.root);
bus.close();
await box.cleanup();
```

## High-churn trees stay excluded

`procedure/runs` and `store/trash` are never live-rendered and churn constantly;
watching them exhausted the server's inotify limit on 2026-06-11. Dotfile trees
(`.git`, `.callback-box`) are excluded for the same reason. Ordinary content
trees receive no path-specific treatment: the generic watch budget is their
safety boundary.

```ts
const box = await makeTmpBox();
const bus = createEventBus(box.root, { pollInterval: 60_000 });
await mkdir(join(box.root, "procedure", "runs", "r1"), { recursive: true });
await mkdir(join(box.root, "store", "trash", "old"), { recursive: true });
await mkdir(join(box.root, "box", "inbox", "email", "thread.attach"), { recursive: true });
await mkdir(join(box.root, "store", "keep"), { recursive: true });

const watcher = ensureBoxWatcher(box.root, { eventBus: bus });
await watcher.ready;

watcher.watchedDirs().join(" ")
=> . box box/inbox box/inbox/email box/inbox/email/thread.attach procedure store store/keep
```

```ts cleanup
await closeBoxWatcher(box.root);
bus.close();
await box.cleanup();
```

## Notification bookkeeping has a hard budget

A directory can arrive already holding thousands of distinct files. Each path
would normally open its own coalescing window, so this work is capped just like
directory watches. Excess hints are deliberately dropped and the degradation is
reported once; filesystem events are only a frontend freshness convenience.

The watcher takes its bound from the caller, so this proves the boundary at 16
rather than at the production 1,024 — see [the note on scale](#the-production-defaults-are-what-the-bounds-tests-scale-down-from)
below for why the magnitude is not what carries the coverage.

```ts
const box = await makeTmpBox();
const bus = createEventBus(box.root, { pollInterval: 60_000 });
await mkdir(join(box.root, "store"), { recursive: true });
await mkdir(join(box.root, ".incoming"), { recursive: true });
for (let i = 0; i < 64; i++) {
  await writeFile(join(box.root, ".incoming", `file-${i}.txt`), "x");
}

const watcher = ensureBoxWatcher(box.root, { eventBus: bus, maxNotificationWork: 16 });
await watcher.ready;
await waitForWatch(box.root, bus, "store");

let events = 0;
bus.subscribe({ listener: (e) => { if (e.event === "file-change") events++; } });
const capLogs: string[] = [];
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const line = args.map(String).join(" ");
  if (line.includes("notification work limit")) capLogs.push(line);
  else originalConsoleError(...args);
};
try {
  const { rename } = await import("node:fs/promises");
  await rename(join(box.root, ".incoming"), join(box.root, "store", "arrived"));
  await waitFor(() => capLogs.length === 1, 10_000, "the notification work limit");
  await watcher.settled();
} finally {
  console.error = originalConsoleError;
}

`bounded: ${events <= 20} | logs: ${capLogs.length} | named-limit: ${capLogs[0]?.includes("16") === true}`
=> bounded: true | logs: 1 | named-limit: true
```

```ts cleanup
await closeBoxWatcher(box.root);
bus.close();
await box.cleanup();
```

## A dotted ancestor outside the box does not disable watching

Dot paths *inside* a box are ignored. A box root may itself live below a hidden
directory, and that ancestor is outside the relative-path filter.

```ts
const outer = await makeTmpBox();
const nestedRoot = join(outer.root, ".container", "content");
await mkdir(join(nestedRoot, "store"), { recursive: true });
const bus = createEventBus(nestedRoot, { pollInterval: 60_000 });

const watcher = ensureBoxWatcher(nestedRoot, { eventBus: bus });
await watcher.ready;

watcher.watchedDirs().join(" ")
=> . store
```

```ts cleanup
await closeBoxWatcher(nestedRoot);
bus.close();
await outer.cleanup();
```

## The watcher has a hard directory budget

An unexpectedly large imported tree must degrade live updates instead of
allocating watchers until `cb serve` runs out of memory. Hitting the ceiling is
reported exactly once, and the initial walk still resolves normally.

The walk is breadth-first and sequential, so the watched set at the ceiling is
exact rather than merely bounded: the root, `bulk`, and the first 14 of its
children.

```ts
const box = await makeTmpBox();
const bus = createEventBus(box.root, { pollInterval: 60_000 });
await mkdir(join(box.root, "bulk"), { recursive: true });
for (let i = 0; i < 64; i++) {
  await mkdir(join(box.root, "bulk", `dir-${i}`));
}

const capLogs: string[] = [];
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const line = args.map(String).join(" ");
  if (line.includes("directory watch limit")) {
    capLogs.push(line);
  } else {
    originalConsoleError(...args);
  }
};
let watcher: ReturnType<typeof ensureBoxWatcher>;
try {
  watcher = ensureBoxWatcher(box.root, { eventBus: bus, maxWatchedDirs: 16 });
  await watcher.ready;
} finally {
  console.error = originalConsoleError;
}

`watched: ${watcher.watchedDirs().length} | logs: ${capLogs.length} | named-limit: ${capLogs[0]?.includes("16") === true}`
=> watched: 16 | logs: 1 | named-limit: true
```

```ts cleanup
await closeBoxWatcher(box.root);
bus.close();
await box.cleanup();
```

## The production defaults are what the bounds tests scale down from

Both bounds above are proved at 16 because their production magnitude of 1,024
buys nothing and costs a great deal. Materializing a 1,024-directory ceiling
means opening and then closing 1,024 real `fs.watch` handles, and on macOS each
`close()` is a blocking round-trip to libuv's single FSEvents run-loop thread —
measured at roughly six seconds for 1,024 handles on a loaded machine, and
super-linear in the count, against a fraction of a second idle. That is what
made this file take 8 seconds alone and expire past tap's 300-second per-file
limit under parallel suite load
(`issues/bugs/2026-08-06-file-watcher-doctest-suite-timeout.md`). The number
1,024 is a capacity decision about a real server, not a behavior of this module,
so it is pinned here directly and the boundary logic is exercised where it is
cheap.

```ts
`dirs: ${MAX_WATCHED_DIRS} | notifications: ${MAX_NOTIFICATION_WORK} | coalesce: ${COALESCE_MS}`
=> dirs: 1024 | notifications: 1024 | coalesce: 50
```
