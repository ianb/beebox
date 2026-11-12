// # bbx figure run
//
// docs/implemented-plans/figure-check.md. A canvas-loop figure renders headlessly from a
// box: the entry compiles for Node, runs in a child under a timeout, and the
// transcript and frames land under _tmp/figure-run/.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { listCanvasLoopFigures, prepareFigureJob, runFigureJob } from "../../../../src/cli/commands/figure/run.js";
import { any } from "@ianbicking/tap-check/check";
import { findReservedNestedSegment } from "../../../../src/lib/box-reserved-segments.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

const CARD = "_content/figs/Dot.figure.card";

const card = (params: string): string => `---\ntype: figure\ntitle: Dot\nruntime: canvas-loop\nentry: attach/dot-tea.ts\n${params}---\nA dot.\n`;

// A sketch that counts presses it acknowledges and reads its speed param at init.
const ENTRY = `import type { Msg, ParamsDecl, Util, View } from "@ianbicking/canvas-loop";
export const params = { speed: { type: "number", min: 0, max: 5, default: 1 } } as const satisfies ParamsDecl;
export const canvas = { width: 60, height: 40 };
export function init(u: Util<typeof params>) { return { n: 0, speed: u.params.speed }; }
export function update(model: { n: number; speed: number }, msg: Msg, u: Util<typeof params>) {
  if (msg.type === "mousedown") { u.handled("dot"); return { ...model, n: model.n + 1 }; }
  return model;
}
export function draw(v: View, model: { n: number; speed: number }) {
  v.background("#fff");
  v.text(\`n=\${model.n} speed=\${model.speed}\`, { x: 2, y: 2 });
  v.text("overlap", { x: 4, y: 4 });
}
export default (cl: { mountSketch: (m: unknown, o: unknown) => () => void }, ctx: { mount: unknown }) =>
  cl.mountSketch(ctx.mount, { module: { params, canvas, init, update, draw }, autoplay: !matchMedia("(prefers-reduced-motion: reduce)").matches });
`;

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
  t.check(result.warnings, [any(String).includes('overlaps text "overlap"'), any(String).includes('overlaps text "overlap"')]);
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

  await box.write("_content/figs/Dot.attach/dot-tea.ts", ENTRY.replace("return { n: 0, speed: u.params.speed };", "for (;;) {}"));
  const { cardRel, job } = await prepareFigureJob({ boxRoot: box.root, card: CARD, frames: 1, params: {} });
  const result = await runFigureJob({ boxRoot: box.root, cardRel, job, timeoutMs: 3000 });
  t.check(result.ok, false);
  t.check(result.errors, [any(String).startsWith("stopped after 3 s")]);
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
