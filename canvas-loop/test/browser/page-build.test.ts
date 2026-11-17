// `cli page`'s pure parts: how sketch files become nav keys and labels, the
// entry module that imports them, and which checkouts get a dev-router URL.
import assert from "node:assert/strict";
import { test } from "node:test";
import { devUrl, entrySource, pageEntries } from "../../src/browser/page-build.js";

test("a sketch-tea.ts is named by its directory (a version directory with its parent), any other file by its name; repeats get a suffix", () => {
  assert.deepEqual(pageEntries(["/p/thimble-quay/sketch-tea.ts", "/p/forest/v3/sketch-tea.ts", "/ex/bounce-tea.ts", "/q/thimble-quay/sketch-tea.ts"]), [
    { key: "thimble-quay", label: "thimble-quay", path: "/p/thimble-quay/sketch-tea.ts" },
    { key: "forest-v3", label: "forest v3", path: "/p/forest/v3/sketch-tea.ts" },
    { key: "bounce", label: "bounce", path: "/ex/bounce-tea.ts" },
    { key: "thimble-quay-2", label: "thimble-quay", path: "/q/thimble-quay/sketch-tea.ts" },
  ]);
});

test("the entry imports each sketch by its path and lists it under its key", () => {
  const source = entrySource(pageEntries(["/p/a b/sketch-tea.ts"]), "/pkg/live-page.ts");
  assert.equal(
    source,
    ['import { livePage } from "/pkg/live-page.ts";', 'import * as s0 from "/p/a b/sketch-tea.ts";', "livePage([", '  { key: "a-b", label: "a b", module: s0 },', "]);", ""].join("\n"),
  );
});

test("a URL only for a checkout the router serves", () => {
  assert.equal(devUrl("/u/src/beebox-worktrees/canvas-brushes", "canvas-loop-pages/x.html"), "http://localhost:3210/canvas-brushes/dev/canvas-loop-pages/x.html");
  assert.equal(devUrl("/u/src/beebox", "canvas-loop-pages/x.html"), "http://localhost:3210/main/dev/canvas-loop-pages/x.html");
  assert.equal(devUrl("/tmp/clone", "canvas-loop-pages/x.html"), undefined);
});
