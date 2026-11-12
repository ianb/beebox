import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkpointPage } from "../../../src/headless/checkpoint/page.js";
import { saveCheckpoint } from "../../../src/headless/checkpoint/save.js";
import { tmpDir } from "../../helpers.js";

test("each run saves a numbered checkpoint with sources, frames and note; the page steps through them", () => {
  const root = tmpDir();
  const sketchDir = join(root, "sketch");
  const outDir = join(root, "out");
  const checkpoints = join(root, "checkpoints");
  mkdirSync(sketchDir);
  mkdirSync(outDir);
  writeFileSync(join(outDir, "frame-0000.png"), Buffer.from([137, 80, 78, 71]));
  const sketchPath = join(sketchDir, "sketch.ts");
  writeFileSync(sketchPath, "a\nb\n");
  saveCheckpoint(checkpoints, { sketchPath, eventsPath: undefined, outDir, args: ["run"], note: "first", errors: [] });
  writeFileSync(sketchPath, "a\nc\nd\n");
  const second = saveCheckpoint(checkpoints, { sketchPath, eventsPath: undefined, outDir, args: ["run"], note: "second", errors: [] });
  assert.ok(second.endsWith("0002"));
  assert.ok(existsSync(join(second, "sources", "sketch.ts")) && existsSync(join(second, "frames", "frame-0000.png")));
  assert.equal(JSON.parse(readFileSync(join(second, "meta.json"), "utf8")).note, "second");
  const page = checkpointPage(checkpoints, "test");
  assert.match(page, /"note":"second"/);
  assert.match(page, /"changes":\[{"file":"sketch.ts","added":2,"removed":1}]/, "b → c, d is +2 −1");
});
