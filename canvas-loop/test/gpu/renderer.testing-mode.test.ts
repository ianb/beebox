// The renderer's testing-mode decisions that need no GPU (chunk 3 of the
// scene core plan): node paths in render errors, the atlas cut at the
// largest texture, and which marks get a peak slot with what group opacity.
import assert from "node:assert/strict";
import { test } from "node:test";
import { shelfPack } from "../../src/gpu/atlas.js";
import type { Item, Job } from "../../src/gpu/jobs.js";
import { ATLAS_MAX, cutOf } from "../../src/gpu/jobs.js";
import { NodePath, atPath, nodeName } from "../../src/gpu/node-path.js";
import { planPeaks } from "../../src/gpu/peaks.js";
import { GpuRenderError, UnsupportedCallError } from "../../src/scene/errors.js";
import type { SceneNode, ShapeNode } from "../../src/scene/nodes.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";

const nodes = (): readonly SceneNode[] =>
  new SceneRecorder({ width: 100, height: 100 }).record((v) => {
    const p = v.picture({ key: "citizen", width: 10, height: 10 }, () => v.circle(5, 5, 4, { fill: "#000" }));
    v.group({ name: "room" }, () => v.place(p, 0, 0));
    v.group({}, () => v.rect(0, 0, 1, 1, { fill: "#000" }));
    v.at({ translate: [1, 1] }, () => v.line(0, 0, 5, 5, { stroke: "#000", brush: "pencil" }));
  }).scene.children;

test("node names: a group by its name, a placement by its picture's key, other nodes by call and place among siblings", () => {
  const [room, unnamed, at] = nodes();
  assert.ok(room?.kind === "group" && unnamed !== undefined && at?.kind === "at");
  const [place] = room.children;
  const [line] = at.children;
  assert.ok(place !== undefined && line !== undefined);
  assert.deepEqual([nodeName(room, 1), nodeName(place, 1), nodeName(unnamed, 2), nodeName(at, 3), nodeName(line, 1)], ['group "room"', 'place picture "citizen"', "group #2", "at #3", "line #1"]);
});

test("render errors: the renderer's own errors and unsupported calls name the path once; other errors pass through", () => {
  const path = ['group "room"', 'place picture "citizen"', "circle #4"];
  const own = atPath(new GpuRenderError({ detail: "too big" }), path);
  assert.equal(own?.message, 'GPU renderer: too big (at group "room" > place picture "citizen" > circle #4)');
  assert.equal(own?.path, 'group "room" > place picture "citizen" > circle #4');
  const unsupported = new UnsupportedCallError({ call: "group effects under a skew" });
  const wrapped = atPath(unsupported, path);
  assert.ok(wrapped instanceof GpuRenderError && wrapped.cause === unsupported);
  assert.match(wrapped.message, /^GPU renderer: UnsupportedCallError: group effects under a skew is not supported yet \(at group "room" >/);
  assert.equal(atPath(own, ["outer"]), undefined, "an error that names a path keeps it (the innermost node)");
  assert.equal(atPath(new RangeError("x"), path), undefined);
  assert.equal(atPath(new GpuRenderError({ detail: "x" }), []), undefined);
});

test("render errors, through NodePath: the innermost open node's path, and the stack is left empty", () => {
  const [room] = nodes();
  assert.ok(room?.kind === "group");
  const [place] = room.children;
  assert.ok(place !== undefined);
  const path = new NodePath();
  assert.throws(
    () => path.inside(room, { index: 1, lower: () => path.inside(place, { index: 1, lower: () => { throw new GpuRenderError({ detail: "boom" }); } }) }),
    (e: unknown) => e instanceof GpuRenderError && e.path === 'group "room" > place picture "citizen"',
  );
  assert.throws(() => path.inside(room, { index: 1, lower: () => { throw new GpuRenderError({ detail: "again" }); } }), (e: unknown) => e instanceof GpuRenderError && e.path === 'group "room"');
});

test("the atlas cut: 2 px past what can be seen, except on an axis where that passes the atlas side", () => {
  assert.deepEqual(cutOf({ x0: 0, y0: 0, x1: 100, y1: 50 }), { x0: -2, y0: -2, x1: 102, y1: 52 });
  assert.deepEqual(cutOf({ x0: 0, y0: 0, x1: ATLAS_MAX, y1: 8 }), { x0: 0, y0: -2, x1: ATLAS_MAX, y1: 10 });
  const pages = shelfPack([{ box: { x0: 0, y0: 0, x1: ATLAS_MAX, y1: 8 } }], ATLAS_MAX);
  assert.deepEqual(pages, [{ w: ATLAS_MAX, h: 9 }], "a piece as wide as the atlas fits on its page, with no gap after it");
});

const job = (name: string, items: Item[]): Job => ({ name, rect: { x0: 0, y0: 0, x1: 100, y1: 100 }, items, clips: [], fx: undefined });
const common = { box: { x0: 10, y0: 10, x1: 20, y1: 20 }, mode: 0, clip: null } as const;
const paint = { kind: 0, color: [0, 0, 0, 1], inv: [1, 0, 0, 1, 0, 0], scaleY: 1, grad: [0, 0, 0, 0], stops: [] } as const;
const brush = { grain: 0, opacity: 1, paper: { toPaper: [1, 0, 0, 1, 0, 0], scale: 1, lo: 0, hi: 1, seed: 0, width: 1 } } as const;
const shape = (call: string): ShapeNode => ({ kind: "shape", call, geom: { kind: "rect", x: 0, y: 0, w: 1, h: 1 }, style: { fill: undefined, stroke: "#000", weight: 1, dash: undefined, cap: "butt", join: "miter", blend: "normal", erase: false, effects: undefined, brush: undefined, material: undefined, effectsPaper: undefined } });
const mark = (node: ShapeNode | undefined, a?: { erase?: boolean; box?: Item["box"] }): Item => ({ ...common, ...(a?.box === undefined ? {} : { box: a.box }), erase: a?.erase ?? false, k: "mark", source: { kind: "tex", mark: { box: common.box, dabs: [], runs: [], ox: 0, oy: 0 } }, tinted: false, paint, brush, node });
const layer = (child: Job, opacity: number): Item => ({ ...common, erase: false, k: "layer", job: child, mask: undefined, opacity });

test("peak slots: one per colour mark's node, with the largest product of opacities along any path from the canvas", () => {
  const a = shape("line");
  const b = shape("curve");
  const c = shape("arc");
  const tile = job("tile", [mark(a)]);
  const faded = job("faded", [layer(tile, 0.5), mark(b)]);
  const mask = job("mask", [mark(c)]);
  const body = job("body", []);
  const root = job("canvas", [layer(faded, 0.2), layer(tile, 0.8), { ...common, erase: false, k: "layer", job: body, mask, opacity: 1 }, mark(undefined), mark(c, { erase: true }), mark(c, { box: { x0: 200, y0: 0, x1: 210, y1: 10 } })]);
  const plan = planPeaks([tile, faded, mask, body, root]);
  assert.deepEqual(plan.marks.map((m) => [m.node.call, m.groups]), [["line", 0.8], ["curve", 0.2]], "the tile is reached at 0.2 × 0.5 and at 0.8; marks in a mask, erasing, without a node or outside the layer get no slot");
  assert.equal(plan.slots.get(tile.items[0] ?? mark(undefined)), 1);
});
