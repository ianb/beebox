// # Schema hot reload
//
// A running server watches the box's `src/schemas` and drops its cached
// schemas when a file changes (`core/schema-watcher.ts`). An editor's write
// burst must cause one invalidation, after the last write, and a box with no
// local schemas must still start (docs/implemented-plans/small-dependency-sweep.md).
import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { eventually } from "@ianbicking/tap-check/check";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleepFor } from "node:timers/promises";
import * as schemas from "../../src/schemas.js";
import type * as SchemaWatcher from "../../src/core/schema-watcher.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

async function watcherCountingInvalidations(t: Test) {
  const invalidated: string[] = [];
  const module = await t.mockImport<typeof SchemaWatcher>("../../src/core/schema-watcher.ts", {
    "../../src/schemas.ts": { ...schemas, invalidateBoxSchemas: (root: string) => invalidated.push(root) },
  });
  return { ...module, invalidated };
}

test("a write in three chunks invalidates once, after the last", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write("src/schemas/note.ts", "export const a = 1;\n");
  const { ensureSchemaWatcher, closeSchemaWatcher, invalidated } = await watcherCountingInvalidations(t);
  await ensureSchemaWatcher(box.root);
  t.teardown(() => closeSchemaWatcher(box.root));

  for (const chunk of ["export const a = 2;\n", "export const b = 3;\n", "export const c = 4;\n"]) {
    await box.write("src/schemas/note.ts", chunk);
    await sleepFor(50);
  }
  // Inside the quiet window the burst has not fired yet.
  t.check(invalidated, []);
  await eventually(() => invalidated.length > 0, { label: "invalidation" });
  await sleepFor(300);
  t.check(invalidated, [box.root]);
});

test("a box without src/schemas starts with no watcher and no error", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  rmSync(join(box.root, "src/schemas"), { recursive: true, force: true });
  t.check(existsSync(join(box.root, "src/schemas")), false);
  const { ensureSchemaWatcher, closeSchemaWatcher } = await watcherCountingInvalidations(t);
  await t.check(ensureSchemaWatcher(box.root), undefined);
  await t.check(closeSchemaWatcher(box.root), undefined);
});
