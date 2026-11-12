// # Box file watcher — directory watches, not file watches
//
// `ensureBoxWatcher` watches a box root so agent edits surface as `file-change`
// events. It watches **directories only**. That is the whole point of the module:
// chokidar, which this replaced, called `fs.watch()` once per *file*, and on macOS
// a file watch holds an open read descriptor for that file's whole life. A box
// with ~9.4k files pinned ~9.4k FDs in `bbx serve` and pushed the process past
// macOS's legacy per-process `OPEN_MAX` of 10240 — past which *every* `spawn()`
// fails with `EBADF`, so the chat agent could not start at all
// (`issues/bugs/2026-08-03-intermittent-spawn-ebadf-sdk-chat-run.md`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, containing, eventually, str } from "@ianbicking/tap-check/check";
import {
  ensureBoxWatcher,
  closeBoxWatcher,
  MAX_WATCHED_DIRS,
  MAX_NOTIFICATION_WORK,
  COALESCE_MS,
  type WatchDir,
} from "../../../src/core/box/file-watcher.js";
import { watchLimitStatus } from "../../../src/core/box/watch-limit.js";
import { watchLimitHealthChecks } from "../../../src/webapp/trpc/routers/health/checks/watch-limit.js";
import { createEventBus, type BusEvent } from "../../../src/core/event-bus/core.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { mkdir, writeFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** The path of a `file-change` event, or undefined for any other event. */
function fileChangePath(event: BusEvent): string | undefined {
  return event.event === "file-change" ? event.data.path : undefined;
}

/** How many descriptors this process holds right now. */
const openFDs = () => readdirSync("/dev/fd").length;

/**
 * A `watchDir` the test drives. Real notifications arrive whenever the
 * platform gets to them — seconds late on a loaded host — so a test of what
 * the watcher *does* with an event fires that event itself, then awaits
 * `watcher.settled()` for the reconcile it queued. `fire` throws for a
 * directory with no live watch: the platform would deliver nothing there, so
 * a test that fires one has a wrong premise.
 *
 * Tests that only read the watched set use it too. Which directories get
 * watched is this module's walk and filters; a real handle adds nothing there,
 * and on macOS each one costs a round-trip to the shared FSEvents thread to
 * open and again to close, which a loaded host stretches to seconds.
 */
function fakeWatch(): { watchDir: WatchDir; fire(args: { dir: string; event: string; filename: string }): void } {
  const live = new Map<string, (event: string, filename: string | null) => void>();
  return {
    watchDir: (dir, listener) => {
      live.set(dir, listener);
      return { close: () => { live.delete(dir); }, on: () => null };
    },
    fire({ dir, event, filename }) {
      const listener = live.get(dir);
      if (!listener) throw new Error(`no live watch on ${dir}`);
      listener(event, filename);
    },
  };
}

/** Seed `count` files spread over `dirs` directories under the box root. */
async function seedTree({ root, dirs, perDir }: { root: string; dirs: number; perDir: number }): Promise<void> {
  for (let d = 0; d < dirs; d++) {
    const dir = join(root, "store", `dir${d}`);
    await mkdir(dir, { recursive: true });
    for (let f = 0; f < perDir; f++) {
      await writeFile(join(dir, `card${f}.doc.card`), "---\ntitle: Note\n---\nbody\n");
    }
  }
}

/**
 * The directories a fresh box's watcher already covers — whatever `bbx init`
 * scaffolds, read from a real fresh box rather than listed by hand, so new
 * scaffolding cannot make these tests stale. Assertions below filter these
 * out so the expected list reads as "what did *this test* add," matching each
 * test's own scenario rather than the full box skeleton.
 */
const skeletonBox = await makeTmpBox();
const skeletonBus = createEventBus(skeletonBox.root, { pollInterval: 60_000 });
const skeletonWatcher = ensureBoxWatcher(skeletonBox.root, { eventBus: skeletonBus, watchDir: fakeWatch().watchDir });
await skeletonWatcher.ready;
const SKELETON_DIRS = new Set(skeletonWatcher.watchedDirs());
await closeBoxWatcher(skeletonBox.root);
skeletonBus.close();
await skeletonBox.cleanup();

/** `watcher.watchedDirs()`, with the scaffolded skeleton filtered out. */
function testDirs(watcher: { watchedDirs(): string[] }): string[] {
  return watcher.watchedDirs().filter((d) => !SKELETON_DIRS.has(d));
}

// ## One watch per directory — never one per file
//
// The watched set is exactly the box's directories. This is the platform-independent
// statement of the fix: against chokidar this list would also carry all 400 card
// files.
void test("The watched set is exactly the box's directories.", async (t) => {
  t.teardown(async () => {
    try {
      await closeBoxWatcher(box.root);
      bus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const bus = createEventBus(box.root, { pollInterval: 60_000 });
  await seedTree({ root: box.root, dirs: 4, perDir: 100 });

  const watcher = ensureBoxWatcher(box.root, { eventBus: bus, watchDir: fakeWatch().watchDir });
  await watcher.ready;

  t.check(testDirs(watcher), ["store", "store/dir0", "store/dir1", "store/dir2", "store/dir3"]);
});

// ## Dependency trees and publication build output are not watched
//
// A publication project's `dist/` is build output and `node_modules/` is a
// dependency tree; the watcher never descends into either. `project/src/` is
// ordinary box content and stays watched.
void test("A publication project's dist/ is build output and nodemodules/ is a dependenc...", async (t) => {
  t.teardown(async () => {
    try {
      await closeBoxWatcher(box.root);
      bus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const bus = createEventBus(box.root, { pollInterval: 60_000 });
  const project = "_content/trips/Site.attach/project";
  await box.write(`${project}/dist/page.md`, "# Built\n");
  await box.write(`${project}/dist/stray.note.card`, "---\n---\n");
  await box.write(`${project}/node_modules/pkg/README.md`, "# pkg\n");
  await box.write(`${project}/src/readme.md`, "# Source\n");

  const watcher = ensureBoxWatcher(box.root, { eventBus: bus, watchDir: fakeWatch().watchDir });
  await watcher.ready;
  const dirs = watcher.watchedDirs();
  t.check(dirs.filter((d) => d.startsWith(project)), [project, `${project}/src`]);
});

// ## An authored-code root outside the content box emits its package path
//
// Package-layout boxes serve cards from `content/`, but their authored views live
// beside it in `src/views/`. The same watcher covers that small external tree and
// reports the path vocabulary the frontend uses.
void test("Package-layout boxes serve cards from content/, but their authored views live...", async (t) => {
  t.teardown(async () => {
    try {
      subscription.unsubscribe();
      await closeBoxWatcher(contentRoot);
      bus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const contentRoot = join(box.root, "content");
  const sourceDir = join(box.root, "src");
  const viewsDir = join(box.root, "src", "views");
  await mkdir(contentRoot, { recursive: true });
  await mkdir(viewsDir, { recursive: true });
  const bus = createEventBus(contentRoot, { pollInterval: 60_000 });
  const seen: string[] = [];
  const subscription = bus.subscribe({
    listener: (event) => {
      const changed = fileChangePath(event);
      if (changed !== undefined) seen.push(changed);
    },
  });
  const fake = fakeWatch();
  const watcher = ensureBoxWatcher(contentRoot, {
    eventBus: bus,
    additionalRoots: [{ path: sourceDir, eventPathPrefix: "src" }],
    watchDir: fake.watchDir,
  });
  await watcher.ready;

  await writeFile(join(viewsDir, "catalog.tsx"), "export default function Catalog() { return null; }");
  fake.fire({ dir: viewsDir, event: "change", filename: "catalog.tsx" });
  t.check(seen, ["src/views/catalog.tsx"]);
});

// ## Watching 400 files costs a handful of descriptors, not 400
//
// The direct statement of the bug. On macOS this assertion is the one that would
// have caught it: with chokidar the delta here was ~1 per file. (On Linux a watch
// is an inotify registration rather than a descriptor, so the delta is near zero
// either way — the watched-set assertion above is what carries the regression
// there.)
void test("The direct statement of the bug.", async (t) => {
  t.teardown(async () => {
    try {
      bus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const bus = createEventBus(box.root, { pollInterval: 60_000 });
  await seedTree({ root: box.root, dirs: 4, perDir: 100 });

  const before = openFDs();
  const watcher = ensureBoxWatcher(box.root, { eventBus: bus });
  await watcher.ready;
  const grew = openFDs() - before;

  t.check(grew, any(Number).between(-Infinity, 19));

  // Closing gives every one of them back. `close()` drops each directory's subtree
  // while iterating the same map, so a nested tree is where a skipped or repeated
  // entry would show up as a leaked watch.

  await closeBoxWatcher(box.root);
  t.check(watcher.watchedDirs(), []);
  t.check(openFDs() - before, any(Number).between(-Infinity, 0));
});

// ## A write surfaces as a `file-change` carrying the box-relative path
//
// Consumers key on `path` alone, so that is what has to be right.
//
// This is the one test that takes delivery from the real platform watcher, so
// it is the one that would catch `fs.watch` wiring or the platform's
// `(event, filename)` shape breaking. Every later event-driven test uses
// `fakeWatch` instead.
//
// Real delivery has no latency bound and no delivery guarantee. `fs.watch()`
// has no readiness event on macOS, so a write right after it can beat FSEvents
// registration; and under load the kernel drops events, which libuv discards
// silently. So the test rewrites the card until its event arrives: any one
// write may be lost, and the next write is a fresh event. The deadline only
// bounds a hang.
void test("Consumers key on path alone, so that is what has to be right.", async (t) => {
  t.teardown(async () => {
    try {
      await closeBoxWatcher(box.root);
      bus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const bus = createEventBus(box.root, { pollInterval: 60_000 });
  await mkdir(join(box.root, "store"), { recursive: true });

  const seen: string[] = [];
  bus.subscribe({ listener: (e) => { const changed = fileChangePath(e); if (changed !== undefined) seen.push(changed); } });

  const watcher = ensureBoxWatcher(box.root, { eventBus: bus });
  await watcher.ready;

  const card = join(box.root, "store", "Note.doc.card");
  let attempt = 0;
  await eventually(
    async () => {
      if (seen.includes("store/Note.doc.card")) return true;
      await writeFile(card, `---\ntitle: Note\n---\n${attempt++}\n`);
      return false;
    },
    { label: "the card file-change event", timeoutMs: 60_000, intervalMs: 20 },
  );

  // Real platform events may repeat or add the directory itself; the card path must be among them.
  t.check(seen, containing(["store/Note.doc.card"]));
});

// ## Directories created after startup are picked up
//
// A card folder made by the agent mid-session must go live without a restart —
// otherwise the "watch dirs" strategy would silently stop reporting new subtrees.
void test("A card folder made by the agent mid-session must go live without a restart —...", async (t) => {
  t.teardown(async () => {
    try {
      await closeBoxWatcher(box.root);
      bus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const bus = createEventBus(box.root, { pollInterval: 60_000 });
  await mkdir(join(box.root, "store"), { recursive: true });

  const fake = fakeWatch();
  const watcher = ensureBoxWatcher(box.root, { eventBus: bus, watchDir: fake.watchDir });
  await watcher.ready;

  await mkdir(join(box.root, "store", "Trip.attach"), { recursive: true });
  fake.fire({ dir: join(box.root, "store"), event: "rename", filename: "Trip.attach" });
  await watcher.settled();

  t.check(testDirs(watcher), ["store", "store/Trip.attach"]);
});

// ## A replaced directory is re-watched, subtree and all
//
// `mv`, `git checkout`, and an atomic "write a new tree, swap it in" all replace a
// directory's inode under an unchanged path. Keeping the old watches would leave
// them attached to an inode that no longer exists — and, worse, make the path look
// already-watched, so the new subtree would never be watched at all.
void test("mv, git checkout, and an atomic \"write a new tree, swap it in\" all replace a...", async (t) => {
  t.teardown(async () => {
    try {
      await closeBoxWatcher(box.root);
      bus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const bus = createEventBus(box.root, { pollInterval: 60_000 });
  await mkdir(join(box.root, "store", "Trip.attach", "old"), { recursive: true });

  const fake = fakeWatch();
  const watcher = ensureBoxWatcher(box.root, { eventBus: bus, watchDir: fake.watchDir });
  await watcher.ready;

  const { rm, rename } = await import("node:fs/promises");
  await rm(join(box.root, "store", "Trip.attach"), { recursive: true });
  await mkdir(join(box.root, "store", "Staging", "fresh"), { recursive: true });
  await rename(join(box.root, "store", "Staging"), join(box.root, "store", "Trip.attach"));
  // One notification, after the swap: FSEvents may coalesce the remove, create
  // and rename into this. It is the harder case, because the stale watch for
  // the old inode is still in place when the reconcile runs.
  fake.fire({ dir: join(box.root, "store"), event: "rename", filename: "Trip.attach" });
  await watcher.settled();

  t.check(testDirs(watcher), ["store", "store/Trip.attach", "store/Trip.attach/fresh"]);
});

// ## Files already inside a newly-appeared directory are announced
//
// A directory that arrives complete — an agent writing a card folder, a `git
// checkout` — held its files before any watch existed, so nothing else will ever
// report them. The reconciling walk announces what it finds.
void test("A directory that arrives complete — an agent writing a card folder, a git che...", async (t) => {
  t.teardown(async () => {
    try {
      await closeBoxWatcher(box.root);
      bus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const bus = createEventBus(box.root, { pollInterval: 60_000 });
  await mkdir(join(box.root, "store"), { recursive: true });

  const seen: string[] = [];
  bus.subscribe({ listener: (e) => { const changed = fileChangePath(e); if (changed !== undefined) seen.push(changed); } });

  const fake = fakeWatch();
  const watcher = ensureBoxWatcher(box.root, { eventBus: bus, watchDir: fake.watchDir });
  await watcher.ready;

  // Build the tree out of sight, then swap it in whole — no watch can have seen
  // the file being written.
  const { rename } = await import("node:fs/promises");
  await mkdir(join(box.root, "staging"), { recursive: true });
  await writeFile(join(box.root, "staging", "Photo.md"), "hi\n");
  await rename(join(box.root, "staging"), join(box.root, "store", "Trip.attach"));
  fake.fire({ dir: join(box.root, "store"), event: "rename", filename: "Trip.attach" });
  await watcher.settled();

  t.check(seen, ["store/Trip.attach", "store/Trip.attach/Photo.md"]);
});

// ## A directory symlink created at runtime is not followed
//
// The initial walk refuses symlinks (a box may link outside itself, or into
// itself). The runtime path has to agree, or a link planted after startup would
// pull an arbitrary outside tree into the watch set and bypass the exclusions.
void test("The initial walk refuses symlinks (a box may link outside itself, or into its...", async (t) => {
  t.teardown(async () => {
    try {
      await closeBoxWatcher(box.root);
      bus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const bus = createEventBus(box.root, { pollInterval: 60_000 });
  await mkdir(join(box.root, "store"), { recursive: true });
  await mkdir(join(box.root, "junk", "sub", "noisy"), { recursive: true });

  const fake = fakeWatch();
  const watcher = ensureBoxWatcher(box.root, { eventBus: bus, watchDir: fake.watchDir });
  await watcher.ready;

  const { symlink } = await import("node:fs/promises");
  await symlink(join(box.root, "junk", "sub"), join(box.root, "store", "link"));
  // A real directory beside the link, reconciled the same way, shows the
  // reconcile ran: an absent `store/link` then means it was refused.
  await mkdir(join(box.root, "store", "real"), { recursive: true });
  fake.fire({ dir: join(box.root, "store"), event: "rename", filename: "link" });
  fake.fire({ dir: join(box.root, "store"), event: "rename", filename: "real" });
  await watcher.settled();

  t.check(testDirs(watcher), ["junk", "junk/sub", "junk/sub/noisy", "store", "store/real"]);
});

// ## Rapid writes still produce a trailing event
//
// Repeats inside the 50 ms window collapse, but the *last* write still reaches
// consumers. Merely dropping duplicates would leave a client that refetched on the
// first event holding content a later write had already superseded.
//
// The fake watcher delivers each `change` synchronously, so four changes fired in
// one tick all land inside the first window on any host, however loaded. The
// first emits at once; the other three collapse into one trailing event when the
// window closes. Without the trailing edge the count stays at 1, and the consumer
// that refetched on the first event never learns about `v5`.
void test("Repeats inside the 50 ms window collapse, but the last write still reaches co...", async (t) => {
  t.teardown(async () => {
    try {
      await closeBoxWatcher(box.root);
      bus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const bus = createEventBus(box.root, { pollInterval: 60_000 });
  await mkdir(join(box.root, "store"), { recursive: true });
  const card = join(box.root, "store", "Note.doc.card");
  await writeFile(card, "---\ntitle: Note\n---\nv1\n");

  const fake = fakeWatch();
  const watcher = ensureBoxWatcher(box.root, { eventBus: bus, watchDir: fake.watchDir });
  await watcher.ready;
  const store = join(box.root, "store");

  let events = 0;
  bus.subscribe({
    listener: (e) => {
      if (fileChangePath(e) === "store/Note.doc.card") events++;
    },
  });

  for (let i = 0; i < 4; i++) fake.fire({ dir: store, event: "change", filename: "Note.doc.card" });
  t.check(
    // The leading event is synchronous; the other three are held in the window.
    events,
    1,
  );

  // The trailing emission waits on the 50 ms timer, not the platform; the
  // deadline only bounds a hang.
  await eventually(() => events === 2, { label: "the trailing event", timeoutMs: 60_000 });
  t.check(
    // One trailing event for three collapsed changes, not one each.
    events,
    2,
  );
});

// ## High-churn trees stay excluded
//
// `_bookkeeping/procedure/runs` and `_bookkeeping/trash` are never live-rendered and churn constantly;
// watching them exhausted the server's inotify limit on 2026-06-11. `_bookkeeping/archive`
// is never live-rendered either, and its filed items' folders alone passed the watch budget
// on a production box (2026-10-27). Dotfile trees
// (`.git`, `.beebox`) are excluded for the same reason. Ordinary content
// trees receive no path-specific treatment: the generic watch budget is their
// safety boundary.
void test("bookkeeping/procedure/runs and bookkeeping/trash are never live-rendered and...", async (t) => {
  t.teardown(async () => {
    try {
      await closeBoxWatcher(box.root);
      bus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const bus = createEventBus(box.root, { pollInterval: 60_000 });
  await mkdir(join(box.root, "_bookkeeping", "procedure", "runs", "r1"), { recursive: true });
  await mkdir(join(box.root, "_bookkeeping", "trash", "old"), { recursive: true });
  await mkdir(join(box.root, "_bookkeeping", "archive", "captures", "item.attach"), { recursive: true });
  await mkdir(join(box.root, "_content", "inbox", "email", "thread.attach"), { recursive: true });
  await mkdir(join(box.root, "store", "keep"), { recursive: true });

  const watcher = ensureBoxWatcher(box.root, { eventBus: bus, watchDir: fakeWatch().watchDir });
  await watcher.ready;

  t.check(testDirs(watcher), ["_content/inbox/email", "_content/inbox/email/thread.attach", "store", "store/keep"]);
});

// ## Notification bookkeeping has a hard budget
//
// A directory can arrive already holding thousands of distinct files. Each path
// would normally open its own coalescing window, so this work is capped just like
// directory watches. Excess hints are deliberately dropped and the degradation is
// reported once; filesystem events are only a frontend freshness convenience.
//
// The watcher takes its bound from the caller, so this proves the boundary at 16
// rather than at the production 1,024 — see [the note on scale](#the-production-defaults-are-what-the-bounds-tests-scale-down-from)
// below for why the magnitude is not what carries the coverage.
void test("A directory can arrive already holding thousands of distinct files.", async (t) => {
  t.teardown(async () => {
    try {
      await closeBoxWatcher(box.root);
      bus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const bus = createEventBus(box.root, { pollInterval: 60_000 });
  await mkdir(join(box.root, "store"), { recursive: true });
  await mkdir(join(box.root, ".incoming"), { recursive: true });
  for (let i = 0; i < 64; i++) {
    await writeFile(join(box.root, ".incoming", `file-${i}.txt`), "x");
  }

  const fake = fakeWatch();
  const watcher = ensureBoxWatcher(box.root, { eventBus: bus, maxNotificationWork: 16, watchDir: fake.watchDir });
  await watcher.ready;

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
    fake.fire({ dir: join(box.root, "store"), event: "rename", filename: "arrived" });
    await watcher.settled();
  } finally {
    console.error = originalConsoleError;
  }

  t.check(
    { events, capLogs },
    {
      events: 16,
      capLogs: [str`[box-watcher] notification work limit of 16 reached for ${box.root}; excess live-update hints are being dropped`],
    },
  );
});

// ## A dotted ancestor outside the box does not disable watching
//
// Dot paths *inside* a box are ignored. A box root may itself live below a hidden
// directory, and that ancestor is outside the relative-path filter.
void test("Dot paths inside a box are ignored.", async (t) => {
  t.teardown(async () => {
    try {
      await closeBoxWatcher(nestedRoot);
      bus.close();
      await outer.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const outer = await makeTmpBox();
  const nestedRoot = join(outer.root, ".container", "content");
  await mkdir(join(nestedRoot, "store"), { recursive: true });
  const bus = createEventBus(nestedRoot, { pollInterval: 60_000 });

  const watcher = ensureBoxWatcher(nestedRoot, { eventBus: bus, watchDir: fakeWatch().watchDir });
  await watcher.ready;

  t.check(watcher.watchedDirs(), [".", "store"]);
});

// ## The watcher has a hard directory budget
//
// An unexpectedly large imported tree must degrade live updates instead of
// allocating watchers until `bbx serve` runs out of memory. Hitting the ceiling is
// reported exactly once, and the initial walk still resolves normally.
//
// The walk is breadth-first and sequential, so the watched set at the ceiling is
// exact rather than merely bounded: the root, `bulk`, and the first 14 of its
// children.
void test("An unexpectedly large imported tree must degrade live updates instead of allo...", async (t) => {
  t.teardown(async () => {
    try {
      await closeBoxWatcher(box.root);
      bus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
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
    watcher = ensureBoxWatcher(box.root, { eventBus: bus, maxWatchedDirs: 16, watchDir: fakeWatch().watchDir });
    await watcher.ready;
  } finally {
    console.error = originalConsoleError;
  }

  // The first 16 directories of the breadth-first walk include the box's scaffolded skeleton,
  // so only the root's position and the count are pinned.
  t.check(
    { watched: watcher.watchedDirs(), capLogs },
    {
      watched: [".", ...Array.from({ length: 15 }, () => any(String))],
      capLogs: [str`[box-watcher] directory watch limit of 16 reached for ${box.root}; live updates below bulk are disabled`],
    },
  );

  // The limit is also kept for the dashboard's `box-watch-limit` health check, which
  // names where live updates stopped. Closing the watcher clears it:

  const limited = watchLimitStatus(box.root);
  const [check] = watchLimitHealthChecks(box.root);
  t.check(
    { limited, check },
    {
      limited: { maxWatchedDirs: 16, belowPath: "bulk" },
      check: {
        name: "box-watch-limit",
        ok: false,
        message: "Live updates are off below bulk: the box has more than 16 watched directories.",
        severity: "warning",
      },
    },
  );

  await closeBoxWatcher(box.root);
  t.check({ status: watchLimitStatus(box.root), checks: watchLimitHealthChecks(box.root) }, { status: null, checks: [] });
});

// ## The production defaults are what the bounds tests scale down from
//
// Both bounds above are proved at 16 because their production magnitude of 1,024
// buys nothing and costs a great deal. Materializing a 1,024-directory ceiling
// means opening and then closing 1,024 real `fs.watch` handles, and on macOS each
// `close()` is a blocking round-trip to libuv's single FSEvents run-loop thread —
// measured at roughly six seconds for 1,024 handles on a loaded machine, and
// super-linear in the count, against a fraction of a second idle. That is what
// made this file take 8 seconds alone and expire past tap's 300-second per-file
// limit under parallel suite load
// (closed issue 2026-08-06, file-watcher suite timeout). The number
// 1,024 is a capacity decision about a real server, not a behavior of this module,
// so it is pinned here directly and the boundary logic is exercised where it is
// cheap.
void test("Both bounds above are proved at 16 because their production magnitude of 1,02...", async (t) => {
  t.check({ dirs: MAX_WATCHED_DIRS, notifications: MAX_NOTIFICATION_WORK, coalesce: COALESCE_MS }, { dirs: 1024, notifications: 1024, coalesce: 50 });
});
