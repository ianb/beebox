/**
 * Lazy, idempotent per-box file watcher.
 *
 * Watches a box root and emits `file-change` events onto its EventBus so the UI
 * can react to agent edits. One watcher per box root, started on first request
 * and shared thereafter — previously this lived inline in the SSE route, but the
 * WebSocket `events.subscribe` path needs it just as much, so it's extracted to
 * a place both transports (and, after the SSE route is retired, only the
 * subscription) can start it.
 *
 * **Watches directories, never individual files.** This used to be chokidar,
 * which calls `fs.watch()` once per *file* — and on macOS a file watch holds an
 * open read descriptor on that file for as long as it lives. On a box with
 * ~9.4k files that pinned ~9.4k FDs in `cb serve`, pushing the process past
 * macOS's legacy per-process `OPEN_MAX` of 10240, past which *every* spawn in
 * the process fails with `EBADF` — so the chat agent could no longer start at
 * all (see issues/bugs/2026-08-03-intermittent-spawn-ebadf-sdk-chat-run.md).
 * Watching the ~200 directories instead costs **zero** FDs on macOS (the kernel
 * serves them from FSEvents) and ~7x fewer inotify watches on Linux, while
 * still reporting every child add/change/unlink. Node's own
 * `fs.watch(root, { recursive: true })` would also be FD-free, but it offers no
 * per-path filter hook, so the high-churn trees below could not be excluded.
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { EventBus } from "../event-bus.js";

const watchers = new Map<string, BoxWatcher>();

const DOT_SEGMENT = /(^|[/\\])\../;

/**
 * High-churn, never-live-rendered trees that would otherwise eat a watch per
 * subdirectory (procedure/runs/ alone exhausted the server's inotify limit on
 * 2026-06-11).
 */
const HIGH_CHURN_DIRS = ["procedure/runs", "store/trash"];

/**
 * Throttle window for a given `(event, path)` pair. `fs.watch` is chattier than
 * chokidar was — a single write commonly surfaces as two `change` events — and
 * every consumer treats `file-change` as a hint to refetch, so a duplicate is
 * pure waste. Throttled leading-and-trailing, never merely deduplicated: a
 * second write inside the window still produces an event when the window
 * closes, so a consumer that refetched on the first one can't be left holding
 * stale content.
 */
const COALESCE_MS = 50;

/** A watched directory: its watcher, plus the inode it was watching. */
interface WatchedDir {
  watcher: fs.FSWatcher;
  /** Identifies the directory across a replace — see `reconcile`. */
  ino: number;
}

/** Throttle state for one `(event, path)` key. */
interface EmitWindow {
  timer: ReturnType<typeof setTimeout>;
  /** Another change arrived while the window was open. */
  pending: boolean;
}

/** What {@link ensureBoxWatcher} hands back to a caller that wants to observe. */
export interface BoxWatcherHandle {
  /** Resolves when the initial recursive walk has installed every watch. */
  ready: Promise<void>;
  /** Box-relative paths of every watched directory, sorted (`.` is the root). */
  watchedDirs(): string[];
  /** Resolves when every reconcile queued so far has finished. For tests. */
  settled(): Promise<void>;
}

/** One box root's directory watches, plus the throttling state for its emits. */
class BoxWatcher implements BoxWatcherHandle {
  private readonly dirs = new Map<string, WatchedDir>();
  private readonly windows = new Map<string, EmitWindow>();
  private closed = false;
  /**
   * Read `closed` through a call, not the field. Every check after an `await`
   * needs to re-read it (close can land mid-walk), and control-flow narrowing
   * would otherwise treat the field as still-false and flag the re-check dead.
   */
  private isClosed(): boolean { return this.closed; }
  /** Serializes reconciles so two renames of one path can't interleave. */
  private reconciling: Promise<void> = Promise.resolve();
  /** Set by `ensureBoxWatcher` to the initial walk; resolved for a fresh instance. */
  ready: Promise<void> = Promise.resolve();

  constructor(
    private readonly boxRoot: string,
    private readonly eventBus: EventBus,
  ) {}

  /** Whether `absPath` is excluded from watching and from emission. */
  private ignored(absPath: string): boolean {
    if (DOT_SEGMENT.test(absPath)) return true;
    const rel = path.relative(this.boxRoot, absPath);
    return HIGH_CHURN_DIRS.some((dir) => rel === dir || rel.startsWith(dir + path.sep));
  }

  /**
   * Watch `dir` and, recursively, every directory under it. Idempotent per
   * directory. Missing/unreadable directories are skipped: the tree is walked
   * live, so a directory can vanish between the readdir that named it and the
   * watch that would cover it.
   *
   * With `emitDiscovered`, every entry the walk finds is announced. That is for
   * a directory that appeared at runtime: it may already hold files, written
   * before this watch existed, and nothing else will ever report them.
   */
  async addDir(dir: string, opts?: { emitDiscovered: boolean }): Promise<void> {
    if (this.closed || this.dirs.has(dir) || this.ignored(dir)) return;

    // Read the inode before watching so `reconcile` can tell a replaced
    // directory from the same one being touched again.
    const stat = await fsp.lstat(dir).catch(() => null);
    if (stat === null || !stat.isDirectory() || this.isClosed() || this.dirs.has(dir)) return;

    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(dir, (event, filename) => {
        this.onEvent(dir, { event, filename });
      });
    } catch (e: unknown) {
      // ENOENT/ENOTDIR: the directory went away mid-walk. Anything else is
      // worth seeing — a watch we silently dropped is a dead region of the UI.
      if (errnoOf(e) !== "ENOENT" && errnoOf(e) !== "ENOTDIR") {
        console.warn(`[box-watcher] cannot watch ${path.relative(this.boxRoot, dir)}:`, e);
      }
      return;
    }
    watcher.on("error", (error) => {
      console.error(`[box-watcher] watch error on ${path.relative(this.boxRoot, dir)}:`, error);
      this.dropSubtree(dir);
    });
    this.dirs.set(dir, { watcher, ino: stat.ino });

    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (e: unknown) {
      if (errnoOf(e) !== "ENOENT" && errnoOf(e) !== "ENOTDIR") {
        console.warn(`[box-watcher] cannot list ${path.relative(this.boxRoot, dir)}:`, e);
      }
      return;
    }
    // Symlinked directories are deliberately not followed: a box may link
    // outside itself (or into itself), and a cycle would walk forever.
    // `Dirent.isDirectory()` is lstat-equivalent, so a symlink is simply not a
    // directory here — `reconcile` uses `lstat` to match.
    await Promise.all(
      entries.map(async (entry) => {
        const child = path.join(dir, entry.name);
        if (this.ignored(child)) return;
        if (opts?.emitDiscovered === true) this.emit("rename", child);
        if (entry.isDirectory()) await this.addDir(child, opts);
      }),
    );
  }

  /**
   * Stop watching `dir` **and everything under it**. Dropping only the named
   * directory would strand its descendants' watches on inodes that are gone (an
   * `mv` or `git checkout` moves a whole subtree at once), and those stale
   * entries would then make `addDir` treat a recreated path as already-watched
   * and skip it — blinding that subtree until a restart.
   */
  private dropSubtree(dir: string): void {
    const prefix = dir + path.sep;
    for (const [watched, entry] of this.dirs) {
      if (watched !== dir && !watched.startsWith(prefix)) continue;
      this.dirs.delete(watched);
      entry.watcher.close();
    }
  }

  /**
   * Handle one raw `fs.watch` event on a watched directory. `filename` is the
   * changed child, or null when the platform could not name it (a rare macOS
   * case) — then the directory itself is the best available report.
   */
  private onEvent(dir: string, raw: { event: string; filename: string | Buffer | null }): void {
    if (this.closed) return;
    const { event, filename } = raw;
    const absPath =
      filename === null ? dir : path.join(dir, typeof filename === "string" ? filename : filename.toString());
    if (this.ignored(absPath)) return;

    // A `rename` is a create, a delete, or a replace — including a whole
    // subtree swapped out under one path.
    if (event === "rename") this.reconcile(absPath);

    this.emit(event, absPath);
  }

  /**
   * Bring the watches for `absPath` back in line with what is on disk.
   * Serialized, so two renames of the same path can't interleave a drop with an
   * add and leave the subtree half-watched.
   */
  private reconcile(absPath: string): void {
    this.reconciling = this.reconciling
      .then(async () => {
        if (this.isClosed()) return;
        // `lstat`, not `stat`: a symlink must not be followed here either, or a
        // link planted at runtime would pull an arbitrary outside tree into the
        // watch set — the initial walk refuses them, and the two must agree.
        const stat = await fsp.lstat(absPath).catch(() => null);
        const existing = this.dirs.get(absPath);
        if (stat === null || !stat.isDirectory()) {
          // Gone, or replaced by a non-directory. A no-op for an ordinary file.
          if (existing) this.dropSubtree(absPath);
          return;
        }
        // Same directory we already watch, merely touched: the watch is live
        // and its subtree is intact, so leave it alone. Comparing inodes (not
        // just the path) is what keeps an ordinary rename inside a watched
        // directory from tearing down and rebuilding its whole subtree.
        if (existing && existing.ino === stat.ino) return;
        // A new directory, or a different inode at a path we were watching —
        // the old watches point at something that is no longer here.
        if (existing) this.dropSubtree(absPath);
        await this.addDir(absPath, { emitDiscovered: true });
      })
      .catch((e: unknown) => {
        console.warn(`[box-watcher] reconciling ${path.relative(this.boxRoot, absPath)} failed:`, e);
      });
  }

  /**
   * Emit a `file-change`, throttled per `(event, path)`. The first event in a
   * window goes out immediately; anything more inside the window is collapsed
   * into a single further emission when the window closes, so repeated writes
   * stay cheap without a consumer ever being left on stale content.
   */
  private emit(event: string, absPath: string): void {
    if (this.closed) return;
    const rel = path.relative(this.boxRoot, absPath);
    const key = `${event}\0${rel}`;

    const open = this.windows.get(key);
    if (open) {
      open.pending = true;
      return;
    }

    this.eventBus.emitTransient("file-change", {
      event,
      path: rel,
      timestamp: new Date().toISOString(),
    });

    const timer = setTimeout(() => {
      const window = this.windows.get(key);
      this.windows.delete(key);
      // Trailing edge: a change we collapsed still needs to reach consumers.
      if (window?.pending === true) this.emit(event, absPath);
    }, COALESCE_MS);
    // The watcher must never be the reason a process stays alive.
    timer.unref();
    this.windows.set(key, { timer, pending: false });
  }

  /** Box-relative paths of every watched directory, sorted. For tests. */
  watchedDirs(): string[] {
    return [...this.dirs.keys()].map((dir) => path.relative(this.boxRoot, dir) || ".").toSorted();
  }

  /** Resolves once every reconcile queued so far has run. For tests. */
  async settled(): Promise<void> {
    await this.reconciling;
  }

  close(): void {
    this.closed = true;
    for (const dir of [...this.dirs.keys()]) this.dropSubtree(dir);
    for (const window of this.windows.values()) clearTimeout(window.timer);
    this.windows.clear();
  }
}

/** The errno of a caught filesystem error, or null. */
function errnoOf(e: unknown): string | null {
  return e instanceof Error && "code" in e && typeof e.code === "string" ? e.code : null;
}

/**
 * Ensure a watcher is running for `boxRoot`. Idempotent — the second and later
 * calls for the same root are no-ops, so every subscriber can call it on start.
 * Dotfiles (.git, .callback-box, …) and high-churn internal trees are excluded
 * so internal churn doesn't surface as file changes or consume watches.
 *
 * Returns the box's watcher handle — the map entry is installed synchronously,
 * so a concurrent caller can't start a second walk. Production callers ignore
 * the return value and let the initial tree walk (`ready`) run in the
 * background; a caller that must observe a settled watcher awaits `ready`.
 */
export function ensureBoxWatcher(boxRoot: string, eventBus: EventBus): BoxWatcherHandle {
  const existing = watchers.get(boxRoot);
  if (existing) return existing;
  const watcher = new BoxWatcher(boxRoot, eventBus);
  watchers.set(boxRoot, watcher);
  watcher.ready = watcher.addDir(boxRoot).catch((e: unknown) => {
    console.error(`[box-watcher] initial walk of ${boxRoot} failed:`, e);
  });
  return watcher;
}

/** Stop and forget a box's watcher (server shutdown). */
export async function closeBoxWatcher(boxRoot: string): Promise<void> {
  const watcher = watchers.get(boxRoot);
  if (!watcher) return;
  watchers.delete(boxRoot);
  watcher.close();
}
