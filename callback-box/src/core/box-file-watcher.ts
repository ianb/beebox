/**
 * Lazy, idempotent per-box file watcher.
 *
 * Watches a box root and emits `file-change` events onto its EventBus so the UI
 * can react to agent edits. One watcher per box root, started on first request
 * and shared thereafter — previously this lived inline in the SSE route, but the
 * WebSocket `events.subscribe` path needs it just as much, so it's extracted to
 * a place both transports (and, after the SSE route is retired, only the
 * subscription) can start it.
 */

import { watch, type FSWatcher } from "chokidar";
import * as path from "node:path";
import type { EventBus } from "./event-bus.js";

const watchers = new Map<string, FSWatcher>();

const DOT_SEGMENT = /(^|[/\\])\../;

/**
 * High-churn, never-live-rendered trees that would otherwise eat an inotify
 * watch per subdirectory (procedure/runs/ alone exhausted the server's limit
 * on 2026-06-11). Same shape as cardworks' GLOB_SKIP_DIRS.
 */
const HIGH_CHURN_DIRS = ["procedure/runs", "store/trash"];

/**
 * Ensure a watcher is running for `boxRoot`. Idempotent — the second and later
 * calls for the same root are no-ops, so every subscriber can call it on start.
 * Dotfiles (.git, .callback-box, …) and high-churn internal trees are excluded
 * so internal churn doesn't surface as file changes or consume watches.
 */
export function ensureBoxWatcher(boxRoot: string, eventBus: EventBus): void {
  if (watchers.has(boxRoot)) return;

  const watcher = watch([boxRoot], {
    persistent: true,
    ignoreInitial: true,
    ignored: (filePath: string) => {
      if (DOT_SEGMENT.test(filePath)) return true;
      const rel = path.relative(boxRoot, filePath);
      return HIGH_CHURN_DIRS.some(
        (dir) => rel === dir || rel.startsWith(dir + path.sep)
      );
    },
  });

  watcher.on("all", (fsEvent, filePath) => {
    eventBus.emitTransient("file-change", {
      event: fsEvent,
      path: path.relative(boxRoot, filePath),
      timestamp: new Date().toISOString(),
    });
  });

  watcher.on("error", (error) => {
    console.error("File watcher error:", error);
  });

  watchers.set(boxRoot, watcher);
}

/** Stop and forget a box's watcher (server shutdown). */
export async function closeBoxWatcher(boxRoot: string): Promise<void> {
  const watcher = watchers.get(boxRoot);
  if (!watcher) return;
  watchers.delete(boxRoot);
  await watcher.close();
}
