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
 * Window for collapsing repeated `(event, path)` pairs into one emission.
 * `fs.watch` is chattier than chokidar was — a single write commonly surfaces
 * as two `change` events — and every consumer treats `file-change` as a hint to
 * refetch, so a duplicate is pure waste.
 */
const COALESCE_MS = 50;

/** What {@link ensureBoxWatcher} hands back to a caller that wants to observe. */
export interface BoxWatcherHandle {
  /** Resolves when the initial recursive walk has installed every watch. */
  ready: Promise<void>;
  /** Box-relative paths of every watched directory, sorted (`.` is the root). */
  watchedDirs(): string[];
}

/** One box root's directory watches, plus the coalescing state for its emits. */
class BoxWatcher implements BoxWatcherHandle {
  private readonly dirs = new Map<string, fs.FSWatcher>();
  private readonly recent = new Map<string, number>();
  private closed = false;
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
   */
  async addDir(dir: string): Promise<void> {
    if (this.closed || this.dirs.has(dir) || this.ignored(dir)) return;

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
      this.dropDir(dir);
    });
    this.dirs.set(dir, watcher);

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
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.addDir(path.join(dir, entry.name))),
    );
  }

  /** Stop watching one directory (it was removed, or its watch errored). */
  private dropDir(dir: string): void {
    const watcher = this.dirs.get(dir);
    if (!watcher) return;
    this.dirs.delete(dir);
    watcher.close();
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

    // A `rename` is a create OR a delete. On a create of a directory, start
    // watching it (and its subtree) so newly-made card folders go live without
    // a restart; on a delete, drop the watch we held.
    if (event === "rename") {
      fsp
        .stat(absPath)
        .then((stat) => (stat.isDirectory() ? this.addDir(absPath) : undefined))
        .catch(() => this.dropDir(absPath));
    }

    this.emit(event, absPath);
  }

  /** Emit a `file-change`, collapsing repeats of the same pair. */
  private emit(event: string, absPath: string): void {
    const rel = path.relative(this.boxRoot, absPath);
    const key = `${event}\0${rel}`;
    const now = Date.now();
    const last = this.recent.get(key);
    if (last !== undefined && now - last < COALESCE_MS) return;
    this.recent.set(key, now);
    if (this.recent.size > 1000) this.pruneRecent(now);

    this.eventBus.emitTransient("file-change", {
      event,
      path: rel,
      timestamp: new Date().toISOString(),
    });
  }

  /** Drop coalescing entries that can no longer suppress anything. */
  private pruneRecent(now: number): void {
    for (const [key, at] of this.recent) {
      if (now - at >= COALESCE_MS) this.recent.delete(key);
    }
  }

  /** Box-relative paths of every watched directory, sorted. For tests. */
  watchedDirs(): string[] {
    return [...this.dirs.keys()].map((dir) => path.relative(this.boxRoot, dir) || ".").toSorted();
  }

  close(): void {
    this.closed = true;
    for (const dir of [...this.dirs.keys()]) this.dropDir(dir);
    this.recent.clear();
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
