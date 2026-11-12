// # Schema hot reload
//
// A running server watches the box's `src/schemas` and drops its cached
// schemas when a file changes (`core/schema-watcher.ts`). An editor's write
// burst must cause one invalidation, after the last write, and a box with no
// local schemas must still start (docs/implemented-plans/small-dependency-sweep.md).
//
// These tests use a fake `fs.watch` and a mocked clock. On a real watch,
// macOS delivers directory events through FSEvents. On a busy Mac
// (2026-11-12) it delivered events 0.2 s to over 30 s late, split one burst
// into batches farther apart than the quiet window, and delivered the
// scaffold's own writes from before the watch started. No fixed wait bounds
// that (issues/closed/bugs/2026-11-12-schema-watcher-chunked-write-test-times-out-under-load.md).
import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs";
import { join } from "node:path";
import { mock } from "node:test";
import * as schemas from "../../src/schemas.js";
import type * as SchemaWatcher from "../../src/core/schema-watcher.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

type WatchListener = (event: string, filename: string | null) => void;

/** Load the watcher with invalidation counted, and optionally a substitute `node:fs`. */
async function watcherCountingInvalidations(t: Test, fsModule?: object) {
  const invalidated: string[] = [];
  const module = await t.mockImport<typeof SchemaWatcher>("../../src/core/schema-watcher.ts", {
    "node:fs": fsModule ?? fs,
    "../../src/schemas.ts": { ...schemas, invalidateBoxSchemas: (root: string) => invalidated.push(root) },
  });
  return { ...module, invalidated };
}

/** `node:fs` whose `watch` records its call and hands its listener to the test instead of the OS. */
function fsWithFakeWatch() {
  const listeners: WatchListener[] = [];
  const watched: { dir: string; options: unknown }[] = [];
  // `on` chains, as an FSWatcher's does.
  const handle = { on: () => handle, close: () => handle };
  // Same call shape as the watcher's `fs.watch(dir, options, listener)`.
  const fakeWatch = (...[dir, options, listener]: [dir: string, options: unknown, listener: WatchListener]) => {
    watched.push({ dir, options });
    listeners.push(listener);
    return handle;
  };
  return { fsModule: { ...fs, watch: fakeWatch }, listeners, watched };
}

test("a write in three chunks invalidates once, after the last", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const { fsModule, listeners } = fsWithFakeWatch();
  const { ensureSchemaWatcher, closeSchemaWatcher, invalidated } = await watcherCountingInvalidations(t, fsModule);
  await ensureSchemaWatcher(box.root);
  t.teardown(() => closeSchemaWatcher(box.root));
  // A missing listener leaves `invalidated` empty, so the checks below catch it.
  const [onEvent] = listeners;

  mock.timers.enable({ apis: ["setTimeout"] });
  t.teardown(() => mock.timers.reset());
  // Three chunks 50 ms apart: each lands inside the 150 ms quiet window of the one before.
  for (let chunk = 0; chunk < 3; chunk++) {
    onEvent?.("change", "note.ts");
    mock.timers.tick(50);
  }
  // 149 ms after the last chunk, 249 ms after the first: a timer that the
  // later chunks did not re-arm, or a shorter window, has fired by now.
  mock.timers.tick(99);
  t.check(invalidated, []);
  // 150 ms after the last chunk: its quiet window has passed.
  mock.timers.tick(1);
  t.check(invalidated, [box.root]);
  // Nothing re-fires once the burst has been handled.
  mock.timers.tick(1000);
  t.check(invalidated, [box.root]);
});

test("the watch covers the box's src/schemas tree and does not hold the process open", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const { fsModule, watched } = fsWithFakeWatch();
  const { ensureSchemaWatcher, closeSchemaWatcher } = await watcherCountingInvalidations(t, fsModule);
  await ensureSchemaWatcher(box.root);
  t.teardown(() => closeSchemaWatcher(box.root));
  // Recursive: a schema in a subfolder counts. Not persistent: see the comment at the `fs.watch` call.
  t.check(watched, [{ dir: join(box.root, "src/schemas"), options: { recursive: true, persistent: false } }]);
});

test("a box without src/schemas starts with no watcher and no error", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  fs.rmSync(join(box.root, "src/schemas"), { recursive: true, force: true });
  t.check(fs.existsSync(join(box.root, "src/schemas")), false);
  const { ensureSchemaWatcher, closeSchemaWatcher } = await watcherCountingInvalidations(t);
  await t.check(ensureSchemaWatcher(box.root), undefined);
  await t.check(closeSchemaWatcher(box.root), undefined);
});
