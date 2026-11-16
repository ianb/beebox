// `cli run --no-typecheck` skips the sketch contract check (returned-scene
// plan, Track 4): a sketch whose exports do not fit, but which runs, renders.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tmpDir } from "../../helpers.js";

const SKETCH = [
  'import type { RootDrawing, View } from "@ianbicking/canvas-loop";',
  "export const canvas = { width: 20, height: 20 };",
  "export function init(): { n: number } { return { n: 0 }; }",
  "export function update(model: { n: number }): { n: number } { return model; }",
  // init's model has no label: a type error at the boundary, harmless at run time.
  "export function draw(v: View, model: { n: number; label: string }): RootDrawing {",
  '  return v.background(model.label === undefined ? "#000" : "#fff");',
  "}",
  "",
].join("\n");

test("--no-typecheck runs a sketch that fails the type check; without it the run stops", () => {
  const dir = tmpDir();
  const path = join(dir, "label-tea.ts");
  writeFileSync(path, SKETCH);
  const run = (extra: readonly string[]): ReturnType<typeof spawnSync> =>
    spawnSync(process.execPath, ["--import", "tsx", "src/headless/cli/main.ts", "run", path, "--frames", "1", "--out", join(dir, "out"), ...extra], { encoding: "utf8" });
  const checked = run([]);
  assert.equal(checked.status, 1, String(checked.stdout));
  assert.match(String(checked.stderr), /the export "draw" does not fit/);
  const unchecked = run(["--no-typecheck"]);
  assert.equal(unchecked.status, 0, String(unchecked.stderr));
  assert.match(readFileSync(join(dir, "out", "transcript.md"), "utf8"), /frame 0/i);
});
