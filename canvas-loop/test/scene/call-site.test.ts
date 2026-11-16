// The sketch's line in a stack when canvas-loop runs bundled (beebox's `bbx`):
// a frame then names the source-mapped path, or the bundle, not the module URL.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runtimePaths, sketchFrames } from "../../src/scene/call-site.js";

const stack = (frames: readonly string[]): string => ["CallSiteError: where the sketch made the call", ...frames.map((f) => `    at fn (${f})`)].join("\n");

test("bundled with source maps: frames under the mapped source path are the runtime's, so the sketch's line is found", () => {
  const paths = runtimePaths({ moduleUrl: "file:///box/beebox/dist/cli.mjs", ownFrame: "/repo/canvas-loop/src/scene/call-site.ts:55:12" });
  const frames = stack([
    "/repo/canvas-loop/src/scene/call-site.ts:55:12",
    "/repo/canvas-loop/src/scene/recorder/view.ts:120:5",
    "/tmp/figure/entry.mjs:31:5",
    "/repo/canvas-loop/src/headless/tea-runtime/runner.ts:174:80",
    "/tmp/figure/caller.mjs:1:1",
  ]);
  assert.deepEqual(sketchFrames(frames, paths), ["/tmp/figure/entry.mjs:31:5"]);
});

test("bundled without source maps: every frame in the bundle is the runtime's", () => {
  const paths = runtimePaths({ moduleUrl: "file:///box/beebox/dist/cli.mjs", ownFrame: "/box/beebox/dist/chunk-a.mjs:900:3" });
  const frames = stack(["/box/beebox/dist/chunk-a.mjs:900:3", "/box/beebox/dist/chunk-a.mjs:420:9", "/tmp/figure/entry.mjs:31:5", "/box/beebox/dist/chunk-a.mjs:77:1"]);
  assert.deepEqual(sketchFrames(frames, paths)[0], "/tmp/figure/entry.mjs:31:5");
});

test("from source: the module URL and its own frame agree", () => {
  const paths = runtimePaths({ moduleUrl: "file:///repo/canvas-loop/src/scene/call-site.ts", ownFrame: "/repo/canvas-loop/src/scene/call-site.ts:55:12" });
  assert.deepEqual(sketchFrames(stack(["/repo/canvas-loop/src/gpu/lower.ts:1:1", "/repo/canvas-loop/src/gallery/clock/sketch-tea.ts:9:3"]), paths), ["/repo/canvas-loop/src/gallery/clock/sketch-tea.ts:9:3"]);
});
