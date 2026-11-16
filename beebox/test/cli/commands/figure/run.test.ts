// # bbx figure run
//
// plan:figure-check. A canvas-loop figure renders headlessly from a
// box: the entry compiles for Node, runs in a child under a timeout, and the
// transcript and frames land under _tmp/figure-run/.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { promises as fs, realpathSync } from "node:fs";
import * as path from "node:path";
import { checkSharedCode, FigureRunError, listCanvasLoopFigures, prepareFigureJob, runFigureJob, type FigureRunResult } from "../../../../src/cli/commands/figure/run.js";
import { sharedTypeErrors } from "../../../../src/cli/commands/figure/command.js";
import { any } from "@ianbicking/tap-check/check";
import { findReservedNestedSegment } from "../../../../src/lib/box-reserved-segments.js";
import { figureStarterSketch } from "../../../../src/templates/builtins/starters.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

const CARD = "_content/figs/Dot.figure.card";

const card = (params: string): string => `---\ntype: figure\ntitle: Dot\nruntime: canvas-loop\nentry: attach/dot-tea.ts\n${params}---\nA dot.\n`;

// A sketch that counts presses it acknowledges and reads its speed param at init.
const ENTRY = `import type { Msg, ParamsDecl, RootDrawing, Util, View } from "@ianbicking/canvas-loop";
export const params = { speed: { type: "number", min: 0, max: 5, default: 1 } } as const satisfies ParamsDecl;
export const canvas = { width: 60, height: 40 };
export function init(u: Util<typeof params>) { return { n: 0, speed: u.params.speed }; }
export function update(model: { n: number; speed: number }, msg: Msg, u: Util<typeof params>) {
  if (msg.type === "mousedown") { u.handled("dot"); return { ...model, n: model.n + 1 }; }
  return model;
}
export function draw(v: View, model: { n: number; speed: number }): RootDrawing {
  return [
    v.background("#fff"),
    v.text(\`n=\${model.n} speed=\${model.speed}\`, { x: 2, y: 2 }),
    v.text("overlap", { x: 4, y: 4 }),
  ];
}
export default (cl: { mountSketch: (m: unknown, o: unknown) => () => void }, ctx: { mount: unknown }) =>
  cl.mountSketch(ctx.mount, { module: { params, canvas, init, update, draw }, autoplay: !matchMedia("(prefers-reduced-motion: reduce)").matches });
`;

/** The message `prepareFigureJob` rejects with. */
async function prepareError(boxRoot: string): Promise<string> {
  try {
    await prepareFigureJob({ boxRoot, card: CARD, params: {} });
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  return "no error";
}

const EVENTS = JSON.stringify([{ frame: 2, type: "mousedown", x: 5, y: 5 }, { frame: 3, type: "mouseup", x: 5, y: 5 }]);

void test("A figure runs headlessly with its sibling events file and the card's param defaults", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write(CARD, card("params:\n  - { name: speed, type: number, default: 2 }\n"));
  await box.write("_content/figs/Dot.attach/dot-tea.ts", ENTRY);
  await box.write("_content/figs/Dot.attach/dot-tea-events.json", EVENTS);
  t.check(await listCanvasLoopFigures(box.root), [CARD]);
  const { cardRel, job } = await prepareFigureJob({ boxRoot: box.root, card: CARD, params: {} });
  const result = await runFigureJob({ boxRoot: box.root, cardRel, job, timeoutMs: 60_000 });
  t.check(
    { ok: result.ok, framesRun: result.framesRun, transcript: result.transcript, errors: result.errors },
    { ok: true, framesRun: 64, transcript: path.join("_tmp", "figure-run", "content", "figs", "Dot", "out", "transcript.md"), errors: [] },
  );
  const transcript = await fs.readFile(path.join(box.root, result.transcript ?? ""), "utf8");
  t.check(transcript, any(String).includes("mousedown (5,5) → dot"));
  t.check(findReservedNestedSegment(result.transcript ?? ""), null);
  // The scene renderer's warnings, each naming the sketch's line: the two labels overlap, and the first is wider than the canvas.
  t.check(result.warnings, [
    any(String).includes('text "overlap" overlaps text "n=0 speed=2"').includes("dot-tea.ts:13:"),
    any(String).includes('text "overlap" overlaps text "n=1 speed=2"').includes("dot-tea.ts:13:"),
    any(String).includes('text "n=1 speed=2" crosses the edge of the 60×40 canvas').includes("dot-tea.ts:12:"),
  ]);
  // The line is the entry's own file: the compiled entry's source map is relative to where entry.mjs is written.
  const named = result.warnings.map((w) => /\(at (.+):\d+:\d+\)$/u.exec(w)?.[1]);
  const real = await fs.realpath(path.join(box.root, "_content/figs/Dot.attach/dot-tea.ts"));
  t.check(named.map((file) => (file === undefined ? undefined : path.resolve(realpathSync(box.root), file))), [real, real, real]);
});

void test("--params overrides a default; a param the sketch lacks is an error", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write(CARD, card(""));
  await box.write("_content/figs/Dot.attach/dot-tea.ts", ENTRY);
  const run = async (params: Record<string, string>): Promise<{ ok: boolean; errors: string[]; transcript: string }> => {
    const { cardRel, job } = await prepareFigureJob({ boxRoot: box.root, card: CARD, frames: 1, params });
    const result = await runFigureJob({ boxRoot: box.root, cardRel, job, timeoutMs: 60_000 });
    const transcript = result.transcript === undefined ? "" : await fs.readFile(path.join(box.root, result.transcript), "utf8");
    return { ok: result.ok, errors: result.errors, transcript };
  };
  const good = await run({ speed: "4" });
  t.check(good.ok, true);
  // A card param the module lacks is one warning here; the browser stays quiet about it.
  await box.write(CARD, card("params:\n  - { name: left, type: number, default: 1 }\n  - { name: speed, type: number }\n  - { name: right, type: string }\n"));
  const { cardRel, job } = await prepareFigureJob({ boxRoot: box.root, card: CARD, frames: 1, params: {} });
  // The other warnings are the scene's (overlapping text); only the card-param one is checked.
  t.check((await runFigureJob({ boxRoot: box.root, cardRel, job, timeoutMs: 60_000 })).warnings.filter((w) => w.startsWith("card params")), [
    "card params not in the module's params: left, right. They set no control and are not set in this run; the factory still reads them from figure.params",
  ]);
  const bad = await run({ sped: "4" });
  t.check(bad.ok, false);
  t.check(bad.errors, [any(String).includes('initial param "sped": the sketch declares no such param')]);
});

void test("A compile error, a non-canvas-loop figure, and an endless loop each fail with a clear reason", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write(CARD, card(""));
  await box.write("_content/figs/Dot.attach/dot-tea.ts", "export const = ;\n");
  await t.checkThrows(() => prepareFigureJob({ boxRoot: box.root, card: CARD, params: {} }), "FigureRunError");

  await box.write("_content/figs/P5.figure.card", "---\ntype: figure\ntitle: P\nruntime: p5js\nentry: attach/s.ts\n---\n");
  await t.checkThrows(() => prepareFigureJob({ boxRoot: box.root, card: "_content/figs/P5.figure.card", params: {} }), 'FigureRunError: _content/figs/P5.figure.card: runtime is "p5js"; only canvas-loop figures run headlessly');

  // The loop must type-check: an init that never returns would fail the contract check before it ran.
  await box.write("_content/figs/Dot.attach/dot-tea.ts", ENTRY.replace("return { n: 0, speed: u.params.speed };", "let i = 0; while (i >= 0) i++; return { n: 0, speed: u.params.speed };"));
  const { cardRel, job } = await prepareFigureJob({ boxRoot: box.root, card: CARD, frames: 1, params: {} });
  const result = await runFigureJob({ boxRoot: box.root, cardRel, job, timeoutMs: 3000 });
  t.check(result.ok, false);
  t.check(result.errors, ["stopped after 3 s: an endless loop in init, update or draw, or rendering too slow here (each captured frame is rendered; try fewer frames, a larger --every, or --timeout)"]);
});

// Need 10 of the box-figures plan: esbuild strips types, so the run type-checks
// the entry, its imports and its exports first, as canvas-loop's cli run does.
// Without it a style value canvas-loop does not have would draw with no error.
void test("A type error in an imported helper, or a wrong style value, stops the run with the file and line", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write(CARD, card(""));
  await box.write("_content/figs/Dot.attach/helper.ts", "export const radius: number = \"four\";\n");
  await box.write("_content/figs/Dot.attach/dot-tea.ts", `import { radius } from "./helper.js";\n${ENTRY.replace('v.background("#fff"),', "v.background(\"#fff\"), v.circle(5, 5, radius, { fill: \"#000\" }),")}`);
  // The helper's error is kept apart, so a whole-box run prints it once (see the shared-code test).
  const thrown = await prepareFigureJob({ boxRoot: box.root, card: CARD, params: {} }).then(() => null, (error: unknown) => error);
  t.check(thrown instanceof FigureRunError ? { message: thrown.message, shared: thrown.shared } : thrown, {
    message: "_content/figs/Dot.attach/dot-tea.ts: the sketch does not type-check, so it was not run: 1 error(s) in files it imports, listed once after the figures: _content/figs/Dot.attach/helper.ts",
    shared: [{ file: "_content/figs/Dot.attach/helper.ts", lines: ["_content/figs/Dot.attach/helper.ts:1:14 - error TS2322: Type 'string' is not assignable to type 'number'."] }],
  });

  await box.write("_content/figs/Dot.attach/dot-tea.ts", ENTRY.replace('v.background("#fff"),', 'v.background("#fff"), v.line(0, 0, 9, 9, { stroke: "#000", cap: "triangle" }),'));
  t.check(await prepareError(box.root), any(String).includes("dot-tea.ts:11:").includes('Type \'"triangle"\' is not assignable'));
});

// A whole-box run reported an error in shared code once per importing figure,
// and ran figures in the trash. Each shared file's errors now print once, the
// trash is skipped, and `--lib` checks src/lib with no figure.
void test("A shared helper's type error is reported once for its importers; trashed figures are not listed; --lib checks src/lib", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write("src/lib/radius.ts", "export const radius: number = \"four\";\n");
  await box.write("src/lib/fine.ts", "export const fine = 1;\n");
  const entry = `import { radius } from "@/src/lib/radius";\n${ENTRY.replace('v.background("#fff"),', 'v.background("#fff"), v.circle(5, 5, radius, { fill: "#000" }),')}`;
  for (const name of ["A", "B"]) {
    await box.write(`_content/figs/${name}.figure.card`, card("").replace("title: Dot", `title: ${name}`));
    await box.write(`_content/figs/${name}.attach/dot-tea.ts`, entry);
  }
  await box.write("_bookkeeping/trash/Gone.figure.card", card(""));
  t.check(await listCanvasLoopFigures(box.root), ["_content/figs/A.figure.card", "_content/figs/B.figure.card"]);
  const results: FigureRunResult[] = [];
  for (const figure of ["_content/figs/A.figure.card", "_content/figs/B.figure.card"]) {
    const error = await prepareFigureJob({ boxRoot: box.root, card: figure, params: {} }).then(() => null, (e: unknown) => e);
    if (error instanceof FigureRunError) results.push({ card: figure, ok: false, errors: [error.message], warnings: [], shared: error.shared });
  }
  const line = "src/lib/radius.ts:1:14 - error TS2322: Type 'string' is not assignable to type 'number'.";
  t.check(sharedTypeErrors(results), [{ file: "src/lib/radius.ts", lines: [line], figures: ["_content/figs/A.figure.card", "_content/figs/B.figure.card"] }]);
  t.check(await checkSharedCode(box.root), { files: 2, errors: [line] });
});

void test("A removed View call is named with what replaces it", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write(CARD, card(""));
  await box.write("_content/figs/Dot.attach/dot-tea.ts", ENTRY.replace('v.background("#fff"),', 'v.background("#fff"), v.cache("k", 10, 10, () => null),'));
  t.check(await prepareError(box.root), any(String).includes("Property 'cache' does not exist on type 'View'").includes("v.cache was removed: use v.picture"));
});

void test("The canvas-loop starter runs clean", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write("_content/figs/Starter.figure.card", "---\ntype: figure\ntitle: Starter\nruntime: canvas-loop\nentry: attach/sketch.ts\n---\nThe starter.\n");
  await box.write("_content/figs/Starter.attach/sketch.ts", figureStarterSketch("canvas-loop"));
  const { cardRel, job } = await prepareFigureJob({ boxRoot: box.root, card: "_content/figs/Starter.figure.card", scene: "first", params: {} });
  const result = await runFigureJob({ boxRoot: box.root, cardRel, job, timeoutMs: 60_000 });
  t.check({ ok: result.ok, errors: result.errors, warnings: result.warnings }, { ok: true, errors: [], warnings: [] });
  // `--scene first` writes the first captured frame's outline into the transcript, and no other frame's.
  const transcript = await fs.readFile(path.join(box.root, result.transcript ?? ""), "utf8");
  t.check([...transcript.matchAll(/^```\nscene \d+×\d+$/gmu)].map((m) => m[0]), ["```\nscene 400×300"]);
});

void test("An entry that links outside the box is refused", async (t) => {
  const box = await makeTmpBox();
  const outside = await makeTmpBox();
  t.teardown(() => box.cleanup());
  t.teardown(() => outside.cleanup());
  await box.write(CARD, card(""));
  await outside.write("dot-tea.ts", ENTRY);
  await fs.mkdir(path.join(box.root, "_content/figs/Dot.attach"), { recursive: true });
  await fs.symlink(path.join(outside.root, "dot-tea.ts"), path.join(box.root, "_content/figs/Dot.attach/dot-tea.ts"));
  await t.checkThrows(() => prepareFigureJob({ boxRoot: box.root, card: CARD, params: {} }), "FigureRunError: entry attach/dot-tea.ts: links outside this box");
});

// The box-figures plan, C2: with no Vulkan driver, Dawn finds no adapter and the
// run says it is the host's problem, with the transcript the runner wrote. The
// Vulkan loader is pointed at one manifest that does not exist, so it loads no
// driver. Linux only: macOS draws through Metal, with no Vulkan loader.
void test("With no Vulkan driver the run gives the possible causes and a transcript", { skip: process.platform === "linux" ? false : "Dawn uses Metal on macOS, so there is no Vulkan driver to hide" }, async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const saved = { files: process.env["VK_DRIVER_FILES"], icd: process.env["VK_ICD_FILENAMES"] };
  t.teardown(() => {
    for (const [name, value] of [["VK_DRIVER_FILES", saved.files], ["VK_ICD_FILENAMES", saved.icd]] as const) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
  });
  const missing = path.join(box.root, "_tmp", "no-such-driver.json");
  process.env["VK_DRIVER_FILES"] = missing;
  process.env["VK_ICD_FILENAMES"] = missing;
  await box.write(CARD, card(""));
  await box.write("_content/figs/Dot.attach/dot-tea.ts", ENTRY);
  const { cardRel, job } = await prepareFigureJob({ boxRoot: box.root, card: CARD, frames: 1, params: {} });
  const result = await runFigureJob({ boxRoot: box.root, cardRel, job, timeoutMs: 60_000 });
  // This text comes only from NoGpuAdapterError, so it also shows the setup reached the adapter request.
  t.check(
    { ok: result.ok, errors: result.errors, transcript: result.transcript },
    {
      ok: false,
      errors: ["no GPU adapter: Dawn found no GPU it can use here. Possible causes: no Vulkan driver is installed (on Linux, Mesa's mesa-vulkan-drivers), the driver does not load inside the box's sandbox, or the driver rejects this machine. Ask the boxholder; rewriting the sketch will not help."],
      transcript: path.join("_tmp", "figure-run", "content", "figs", "Dot", "out", "transcript.md"),
    },
  );
  t.check(await fs.readFile(path.join(box.root, result.transcript ?? ""), "utf8"), any(String).includes("NoGpuAdapterError"));
});
