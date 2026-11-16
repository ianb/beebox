// The sketch contract check (returned-scene plan, Track 4): a type error in a
// sketch, in a file it imports, or between its exports fails the check, and
// `cli run` and `gallery check` stop before rendering such a sketch. The
// fixtures sit in a temp directory, outside the package, as a box figure or a
// scratch sketch would.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { checkGallery } from "../../src/headless/gallery.js";
import { checkSketchTypes } from "../../src/headless/sketch-types.js";
import type { SketchTypeError } from "../../src/headless/sketch-types.js";

const dir = mkdtempSync(join(tmpdir(), "canvas-loop-sketch-types-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const HEAD = 'import type { DeepReadonly, Msg, ParamsDecl, ParamValues, RootDrawing, Util, View } from "@ianbicking/canvas-loop";\n';
const PARAMS = 'export const params = { speed: { type: "number", min: 0, max: 5, default: 1 } } as const satisfies ParamsDecl;\n';
const INIT_UPDATE = [
  "export function init(_u: Util<typeof params>): { n: number } { return { n: 0 }; }",
  "export function update(model: DeepReadonly<{ n: number }>, _msg: Msg, _u: Util<typeof params>): { n: number } { return { n: model.n + 1 }; }",
  "",
].join("\n");

function sketch(name: string, body: { draw: string; imports?: string }): string {
  const path = join(dir, name);
  writeFileSync(path, `${HEAD}${body.imports ?? ""}${PARAMS}${INIT_UPDATE}${body.draw}\n`);
  return path;
}

const clean = sketch("clean-tea.ts", { draw: "export function draw(v: View, model: DeepReadonly<{ n: number }>, p: ParamValues<typeof params>): RootDrawing {\n  return [v.background(\"#fff\"), model.n > 2 && v.circle(10, 10, p.speed, { fill: \"#000\" })];\n}" });
const cases = {
  // An unannotated draw: its inferred return type is checked at the boundary.
  zero: sketch("zero-tea.ts", { draw: "export function draw(v: View, model: DeepReadonly<{ n: number }>) {\n  return model.n && v.rect(0, 0, 1, 1, { fill: \"#000\" });\n}" }),
  nothing: sketch("nothing-tea.ts", { draw: "export function draw(v: View) {\n  v.background(\"#fff\");\n}" }),
  // A model that init does not return. As a method comparison this passes (the parameter is compared both ways).
  model: sketch("model-tea.ts", { draw: "export function draw(v: View, model: DeepReadonly<{ n: number; label: string }>): RootDrawing {\n  return v.text(model.label, { x: 0, y: 0 });\n}" }),
  param: sketch("param-tea.ts", { draw: "export function draw(v: View, _model: unknown, p: { speed: number; size: number }): RootDrawing {\n  return v.circle(10, 10, p.speed, { fill: \"#000\" });\n}" }),
  helper: sketch("helper-tea.ts", { draw: "export function draw(v: View): RootDrawing {\n  return v.circle(10, 10, radius(), { fill: \"#000\" });\n}", imports: 'import { radius } from "./helper.js";\n' }),
};
writeFileSync(join(dir, "helper.ts"), 'export function radius(): number {\n  const r: number = "4";\n  return r;\n}\n');

const errorsIn = (errors: readonly SketchTypeError[], file: string): SketchTypeError[] => errors.filter((e) => e.file === file);

test("one check over several sketches: each case fails where it should, and the clean sketch has no errors", async () => {
  const errors = await checkSketchTypes([clean, ...Object.values(cases)]);
  assert.deepEqual(errorsIn(errors, clean), []);
  const exportError = (file: string, name: string): boolean => errorsIn(errors, file).some((e) => e.line === undefined && e.message.startsWith(`the export "${name}" does not fit the sketch contract`));
  assert.ok(exportError(cases.zero, "draw"), "draw returns a number");
  assert.ok(exportError(cases.nothing, "draw"), "draw returns nothing");
  assert.ok(exportError(cases.model, "draw"), "draw expects another model than init returns");
  assert.ok(exportError(cases.param, "draw"), "draw expects a param that params does not declare");
  const inHelper = errorsIn(errors, join(dir, "helper.ts"));
  assert.deepEqual(inHelper.map((e) => [e.line, e.column, e.code]), [[2, 9, 2322]]);
  assert.deepEqual(errorsIn(errors, cases.helper), []);
  // Every error is in a fixture, so none is in canvas-loop or a boundary file.
  assert.deepEqual(errors.filter((e) => e.file === undefined || !e.file.startsWith(dir)), []);
});

test("a sketch without init names the missing export", async () => {
  const path = join(dir, "no-init-tea.ts");
  writeFileSync(path, `${HEAD}export function draw(v: View): RootDrawing {\n  return v.background("#fff");\n}\n`);
  const errors = await checkSketchTypes([path]);
  assert.ok(errors.some((e) => e.file === path && e.message.startsWith('the export "init" does not fit') && e.message.includes("init")), JSON.stringify(errors));
});

test("cli run stops before the run on a type error, with the error on stderr and in the transcript", () => {
  const out = join(dir, "out");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "stale.png"), "");
  const run = spawnSync(process.execPath, ["--import", "tsx", "src/headless/cli/main.ts", "run", cases.nothing, "--frames", "1", "--out", out], { encoding: "utf8" });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /nothing-tea\.ts - error TS2322: the export "draw" does not fit the sketch contract/);
  const transcript = readFileSync(join(out, "transcript.md"), "utf8");
  assert.match(transcript, /: not run, 1 type error\n/);
  assert.match(transcript, /pass `--no-typecheck` to run it anyway/);
  assert.match(transcript, /the export "draw" does not fit/);
  assert.throws(() => readFileSync(join(out, "stale.png")), "the out directory is emptied, as a run empties it");
});

test("gallery check fails an exercise whose exports do not fit, and does not render it", async () => {
  const gallery = join(dir, "gallery");
  mkdirSync(join(gallery, "bad"), { recursive: true });
  writeFileSync(join(gallery, "bad", "sketch-tea.ts"), readFileSync(cases.model, "utf8"));
  writeFileSync(join(gallery, "bad", "meta.yaml"), "frames: 1\n");
  const result = await checkGallery({ galleryDir: pathToFileURL(`${gallery}/`) });
  assert.equal(result.ok, false);
  assert.deepEqual(result.entries.map((e) => [e.slug, e.ok]), [["bad", false]]);
  assert.match(result.entries[0]?.detail ?? "", /^type errors, not run:\n {2}.*sketch-tea\.ts - error TS2322: the export "draw" does not fit/);
});

test("gallery check renders nothing when any file has a type error", async () => {
  // Exercise "a" imports a helper outside the gallery that has a type error; "b" is clean.
  const gallery = join(dir, "gallery-shared");
  for (const slug of ["a", "b"]) {
    mkdirSync(join(gallery, slug), { recursive: true });
    writeFileSync(join(gallery, slug, "meta.yaml"), "frames: 1\n");
  }
  writeFileSync(join(gallery, "a", "sketch-tea.ts"), readFileSync(cases.helper, "utf8").replace('"./helper.js"', '"../../helper.js"'));
  writeFileSync(join(gallery, "b", "sketch-tea.ts"), readFileSync(clean, "utf8"));
  const result = await checkGallery({ galleryDir: pathToFileURL(`${gallery}/`) });
  assert.deepEqual(result.entries.map((e) => [e.slug, e.ok]), [["(type check)", false], ["a", false], ["b", false]]);
  assert.match(result.entries[0]?.detail ?? "", /helper\.ts:2:9 - error TS2322/);
  for (const entry of result.entries.slice(1)) assert.match(entry.detail, /^not run: the type check failed/);
});
