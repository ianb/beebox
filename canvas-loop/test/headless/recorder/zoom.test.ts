import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseZoom } from "../../../src/headless/recorder/zoom.js";
import { toTeaModule } from "../../../src/headless/tea-load.js";
import { teaRun } from "../../../src/headless/tea-runtime.js";
import type { View } from "../../../src/core/tea.js";
import { readTranscript, teaRunOptions, tmpDir } from "../../helpers.js";

test("parseZoom reads x,y,w,h with an optional @scale", () => {
  assert.deepEqual(parseZoom("10,20,30,40"), { x: 10, y: 20, w: 30, h: 40, scale: 3 });
  assert.deepEqual(parseZoom("0,0,8,8@6"), { x: 0, y: 0, w: 8, h: 8, scale: 6 });
  assert.throws(() => parseZoom("10,20,30"), /must be x,y,w,h/);
  assert.throws(() => parseZoom("0,0,0,10"), /positive width/);
  assert.throws(() => parseZoom("0,0,1000,1000@3"), /over 2400px/);
});

test("a run with zooms writes a crop beside each captured frame and lists it in the transcript", () => {
  const outDir = tmpDir();
  const module = toTeaModule({
    canvas: { width: 40, height: 40 },
    init: () => ({}),
    update: (model: object) => model,
    draw: (v: View): void => v.background("#336699"),
  });
  teaRun(teaRunOptions(module, { outDir, frames: 1, zooms: [parseZoom("5,5,10,10@4")] }));
  assert.ok(existsSync(join(outDir, "frame-0000-zoom1.png")));
  assert.match(readTranscript(outDir), /zoom 5,5 10×10 ×4\n!\[frame 0 zoom 5,5 10×10 ×4]\(frame-0000-zoom1\.png\)/);
});
