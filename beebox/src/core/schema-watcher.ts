/**
 * Per-box watcher over `src/schemas/` that hot-reloads box-local schemas in
 * the long-lived server.
 *
 * `loadBoxSchemas` caches its assembled result (and Node permanently caches
 * `import()` by URL), so without this a running `bbx serve` never sees a box
 * agent's schema edits until restart. We watch the box's schema dir and, on any
 * change, call `invalidateBoxSchemas(boxRoot)` — which drops only the assembled
 * snapshot; the next `loadBoxSchemas` rebuilds it, content-hash-busting just the
 * changed file. Events are coalesced: invalidation runs once the directory has
 * been quiet for 150 ms, so an editor's write burst rebuilds once, after the
 * last write (keep-last-good in the loader is the backstop if a writer pauses
 * longer mid-write).
 *
 * Started at box registration (not on a UI subscription) so a headless server
 * still reloads. One watcher per boxRoot, idempotent.
 *
 * Caveat: this watches the `src/schemas` directory itself (recursively), which
 * catches edits/adds/removals once the dir exists, but not the dir being
 * *created* (a box's first-ever local schema in a previously-empty box).
 * That one-time case is covered by the manual reload endpoint or the next
 * daily recycle — not worth watching the whole `config/` tree for.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { invalidateBoxSchemas } from "../schemas.js";
import { getBoxShape, boxCodePaths } from "../lib/box-shape.js";
import { errnoCode } from "../shared/error-guards.js";

/** How long the directory must be quiet before one invalidation runs. */
const QUIET_MS = 150;

interface SchemaWatcher {
  close(): void;
}

const watchers = new Map<string, SchemaWatcher>();

/** Only schema source files matter: not the generated package.json, not dotfiles. */
function isSchemaSource(filename: string | null): boolean {
  if (filename === null) return true;
  const base = path.basename(filename);
  return !base.endsWith("package.json") && !base.startsWith(".");
}

/**
 * Ensure a schema watcher is running for `boxRoot`. Idempotent — repeat calls
 * for the same root are no-ops. A box without `src/schemas` gets no watcher.
 */
export async function ensureSchemaWatcher(boxRoot: string): Promise<void> {
  if (watchers.has(boxRoot)) return;

  const shape = await getBoxShape(boxRoot);
  const schemasDir = boxCodePaths(shape).schemasDir;
  if (watchers.has(boxRoot)) return; // re-check: an await above allows a concurrent caller to win the race.

  let timer: NodeJS.Timeout | undefined;
  let watcher: fs.FSWatcher;
  try {
    // Never the thing that keeps a process alive: a serving process has its
    // listener for that. A server whose startup failed partway (a plugin
    // timing out under load) is never returned to its caller, so nothing
    // closes this watcher; persistent, it held that process open forever.
    watcher = fs.watch(schemasDir, { recursive: true, persistent: false }, (_event, filename) => {
      if (!isSchemaSource(filename)) return;
      clearTimeout(timer);
      timer = setTimeout(() => invalidateBoxSchemas(boxRoot), QUIET_MS);
      timer.unref();
    });
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return; // no local schemas yet; see the caveat above
    throw error;
  }

  watcher.on("error", (error) => {
    console.error(`Schema watcher error for ${boxRoot}:`, error);
  });

  watchers.set(boxRoot, {
    close: () => {
      clearTimeout(timer);
      watcher.close();
    },
  });
}

/** Stop and forget a box's schema watcher (server shutdown). */
export async function closeSchemaWatcher(boxRoot: string): Promise<void> {
  const watcher = watchers.get(boxRoot);
  if (!watcher) return;
  watchers.delete(boxRoot);
  watcher.close();
}
