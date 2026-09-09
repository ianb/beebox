/**
 * Per-box watcher over `src/schemas/` that hot-reloads box-local schemas in
 * the long-lived server.
 *
 * `loadBoxSchemas` caches its assembled result (and Node permanently caches
 * `import()` by URL), so without this a running `bbx serve` never sees a box
 * agent's schema edits until restart. We watch the box's schema dir and, on any
 * change, call `invalidateBoxSchemas(boxRoot)` — which drops only the assembled
 * snapshot; the next `loadBoxSchemas` rebuilds it, content-hash-busting just the
 * changed file. `awaitWriteFinish` coalesces editor write bursts so a rebuild
 * never reads a half-written file (and keep-last-good in the loader is the
 * backstop if it does).
 *
 * Started at box registration (not on a UI subscription) so a headless server
 * still reloads. One watcher per boxRoot, idempotent.
 *
 * Caveat: chokidar watches the `src/schemas` leaf directly, which reliably
 * catches edits/adds/removals once the dir exists, but does not catch the dir
 * being *created* (a box's first-ever local schema in a previously-empty box).
 * That one-time case is covered by the manual reload endpoint or the next
 * daily recycle — not worth watching the whole `config/` tree for.
 */

import { watch, type FSWatcher } from "chokidar";
import { invalidateBoxSchemas } from "../schemas/registry.js";
import { getBoxShape, boxCodePaths } from "../lib/box-shape.js";

const watchers = new Map<string, FSWatcher>();

/**
 * Ensure a schema watcher is running for `boxRoot`. Idempotent — repeat calls
 * for the same root are no-ops.
 */
export async function ensureSchemaWatcher(boxRoot: string): Promise<void> {
  if (watchers.has(boxRoot)) return;

  const shape = await getBoxShape(boxRoot);
  const schemasDir = boxCodePaths(shape).schemasDir;
  if (watchers.has(boxRoot)) return; // re-check: an await above allows a concurrent caller to win the race.
  const watcher = watch(schemasDir, {
    persistent: true,
    ignoreInitial: true,
    // Only schema source files matter; ignore the generated package.json and
    // any dotfiles.
    ignored: (filePath: string) => filePath.endsWith("package.json"),
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });

  watcher.on("all", () => {
    invalidateBoxSchemas(boxRoot);
  });

  watcher.on("error", (error) => {
    console.error(`Schema watcher error for ${boxRoot}:`, error);
  });

  watchers.set(boxRoot, watcher);
}

/** Stop and forget a box's schema watcher (server shutdown). */
export async function closeSchemaWatcher(boxRoot: string): Promise<void> {
  const watcher = watchers.get(boxRoot);
  if (!watcher) return;
  watchers.delete(boxRoot);
  await watcher.close();
}
