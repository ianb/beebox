// Testing mode's checks that decide on the CPU (chunk 3 of the scene core
// plan): the off-canvas fold under a moving camera, label overlap, missing
// glyphs and removed View members. The folding and message decisions are pure
// functions, tested directly; the recorder tests check they are wired.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import type { TextMeasurer } from "../../src/core/text/measure.js";
import { openTextMeasurer } from "../../src/device/open.js";
import { GlyphWatch } from "../../src/gpu/glyphs.js";
import { SketchUsageError } from "../../src/core/errors.js";
import { RemovedCallError } from "../../src/scene/errors.js";
import type { CallSite } from "../../src/scene/call-site.js";
import type { Drawing, View } from "../../src/core/tea.js";
import { offCanvasMessages } from "../../src/scene/recorder/off-canvas.js";
import type { OffLine } from "../../src/scene/recorder/off-canvas.js";
import { MAX_PAIRS, glyphMessage, newOverlaps, overlapMessage, placedRect, textRect } from "../../src/scene/recorder/text-checks.js";
import type { TextRect } from "../../src/scene/recorder/text-checks.js";
import { REPLACEMENTS } from "../../src/scene/errors.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";

let text: TextMeasurer;
before(async () => {
  text = await openTextMeasurer();
});

const site = (line: string): CallSite => ({ line });
const box = (x0: number, y0: number): OffLine["box"] => ({ x0, y0, x1: x0 + 10, y1: y0 + 10 });
const off = (line: string, a: { what: string; moved: boolean; count?: number }): OffLine => ({ line, what: a.what, box: box(900, 10), count: a.count ?? 1, moved: a.moved });
const canvas = { width: 640, height: 400 };

test("off canvas: lines that stayed put warn one by one; lines that moved fold into one summary, grouped by file", () => {
  const out = offCanvasMessages([off("a.ts:1:2", { what: "rect", moved: false }), off("a.ts:5:3", { what: "circle", moved: true }), off("b.ts:7:1", { what: "path", moved: true, count: 3 })], { canvas, frames: 90 });
  assert.equal(out.length, 2);
  assert.match(out[0] ?? "", /^rect lands entirely off the 640×400 canvas on every frame \(0–89\), the first at \(900,10\)–\(910,20\) .* \(at a\.ts:1:2\)$/);
  assert.equal(out[1], "2 lines draw only off the 640×400 canvas while moving, on every frame 0–89: lines 5:3 (circle) in a.ts; 7:1 (path) in b.ts; a camera that has not reached them, or a wrong sign");
});

test("off canvas: one moving line is told in the singular; a line with no known place says so; no lines, no warnings", () => {
  assert.deepEqual(offCanvasMessages([off("", { what: "rect", moved: true })], { canvas, frames: 3 }), ["1 line draws only off the 640×400 canvas while moving, on every frame 0–2: line an unknown line (rect); a camera that has not reached it, or a wrong sign"]);
  assert.deepEqual(offCanvasMessages([], { canvas, frames: 3 }), []);
});

test("off canvas, through the recorder: a drawing that moves joins the summary; one that never moves warns on its own", () => {
  const rec = new SceneRecorder({ width: 80, height: 60 }, { audit: true });
  for (let t = 0; t < 3; t++) {
    rec.record((v) => {
      return [
        v.rect(500, 10, 10, 10, { fill: "#000" }),
        v.at({ translate: [-5 * t, 0] }, v.rect(300, 10, 10, 10, { fill: "#000" })),
      ];
    });
  }
  const out = rec.offCanvasWarnings();
  assert.equal(out.length, 2);
  assert.match(out[0] ?? "", /^rect lands entirely off the 80×60 canvas on every frame \(0–2\), the first at \(500,10\)/);
  assert.match(out[1] ?? "", /^1 line draws only off the 80×60 canvas while moving, on every frame 0–2: line \d+:\d+ \(rect\) in test\/scene\/recorder\.checks\.test\.ts; a camera/);
});

const rect = (content: string, at: { x: number; y: number; w?: number; h?: number }): TextRect => {
  const [w, h] = [at.w ?? 30, at.h ?? 10];
  return { content, x: at.x, y: at.y, w, h, corners: [[at.x, at.y], [at.x + w, at.y], [at.x, at.y + h], [at.x + w, at.y + h]], site: site(`${content}.ts:1:1`) };
};

test("label overlap: a pair overlapping by more than 2 px is reported once, naming the later text first; touching, equal and blank texts are not", () => {
  const reported = new Set<string>();
  const texts = [rect("left", { x: 0, y: 0 }), rect("right", { x: 20, y: 4 }), rect("touch", { x: 49, y: 0 }), rect("left", { x: 5, y: 1 }), rect(" ", { x: 0, y: 0 })];
  const found = newOverlaps(texts, reported);
  assert.equal(found.length, 1);
  const [o] = found;
  assert.ok(o !== undefined && o !== "more");
  assert.equal(o.second.content, "right");
  assert.equal(overlapMessage(o), 'text "right" overlaps text "left" near (20, 4); move one, or place them with v.textBounds first');
  assert.deepEqual(newOverlaps(texts, reported), [], "each pair once per run");
});

test("label overlap: after 10 pairs in a run, one message says no more are reported, then nothing", () => {
  const reported = new Set<string>();
  const many = Array.from({ length: 12 }, (_, i) => [rect(`a${i}`, { x: i * 100, y: 0 }), rect(`b${i}`, { x: i * 100 + 5, y: 0 })]).flat();
  const found = newOverlaps(many, reported);
  assert.equal(found.length, MAX_PAIRS + 1);
  assert.equal(found.at(-1), "more");
  assert.equal(overlapMessage("more"), "text: more than 10 pairs of texts overlap; no more overlaps are reported this run");
  assert.deepEqual(newOverlaps(many, reported), []);
});

test("label overlap: a text's box is its bounds under the transform, trimmed above and below; a placement moves it", () => {
  const r = textRect("a", { bounds: { x: 0, y: 0, w: 20, h: 10, size: 10 }, matrix: [2, 0, 0, 2, 5, 5], site: site("x") });
  assert.deepEqual([r.x, r.y, r.w, r.h].map((n) => Math.round(n * 100) / 100), [5, 7.4, 40, 15.2]);
  const p = placedRect(r, [0, 1, -1, 0, 100, 0]);
  assert.deepEqual([p.x, p.y, p.w, p.h].map((n) => Math.round(n * 100) / 100), [77.4, 5, 15.2, 40]);
});

function warningsOf(draw: (v: View) => Drawing, options?: { glyphMissing?: (char: string) => boolean }): readonly string[] {
  const rec = new SceneRecorder({ width: 200, height: 100 }, { audit: true, text, ...(options?.glyphMissing === undefined ? {} : { glyphMissing: options.glyphMissing }) });
  return rec.record(draw).warnings;
}

test("label overlap, through the recorder: top-level labels, labels inside a placed picture where it lands, not mask artwork", () => {
  const plain = warningsOf((v) => {
    return [
      v.text("left", { x: 10, y: 20 }, { size: 14 }),
      v.text("right", { x: 16, y: 22 }, { size: 14 }),
    ];
  });
  assert.equal(plain.length, 1);
  assert.match(plain[0] ?? "", /^text "right" overlaps text "left" near \(\d+, \d+\); .* \(at test\/scene\/recorder\.checks\.test\.ts:\d+:\d+\)$/);
  const placed = warningsOf((v) => {
    const tag = v.picture({ key: "tag", width: 60, height: 30 }, () => v.text("in a picture", { x: 2, y: 2 }, { size: 14 }));
    return [
      v.text("over it", { x: 105, y: 52 }, { size: 14 }),
      v.place(tag, 100, 50),
      v.place(tag, 10, 10),
    ];
  });
  assert.equal(placed.length, 1, "the placement at (100, 50) overlaps; the one at (10, 10) does not");
  assert.match(placed[0] ?? "", /text "in a picture" overlaps text "over it"/);
  assert.deepEqual(warningsOf((v) => v.mask(v.text("stencil", { x: 10, y: 20 }, { size: 14 }), v.text("seen", { x: 12, y: 22 }, { size: 14 }))), []);
});

test("label overlap: a rotation inside a picture undone by its placement leaves the label upright, not a box around a box (review probe)", () => {
  const r = textRect("a", { bounds: { x: 0, y: 0, w: 100, h: 10, size: 10 }, matrix: [Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, 0, 0], site: site("x") });
  const back = placedRect(r, [Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2, 0, 0]);
  assert.deepEqual([back.x, back.y, back.w, back.h].map((n) => Math.round(n * 100) / 100), [0, 1.2, 100, 7.6]);
  const out = warningsOf((v) => {
    const tag = v.picture({ key: "tag", width: 200, height: 200 }, () => v.at({ rotate: Math.PI / 4 }, v.text("a long label in a turned picture", { x: 0, y: 0 }, { size: 14 })));
    return [
      v.at({ rotate: -Math.PI / 4 }, v.place(tag, 0, 0)),
      v.text("below it", { x: 20, y: 30 }, { size: 14 }),
    ];
  });
  assert.deepEqual(out, []);
});

test("missing glyph, through the recorder: once per font and character, naming the code point and the line", () => {
  const asked: string[] = [];
  const glyphMissing = (char: string): boolean => {
    asked.push(char);
    return char === "";
  };
  const rec = new SceneRecorder({ width: 200, height: 100 }, { audit: true, text, glyphMissing });
  const first = rec.record((v) => {
    return [
      v.text("a b", { x: 10, y: 20 }, { size: 14 }),
      v.text("", { x: 10, y: 60 }, { size: 14 }),
    ];
  }).warnings;
  assert.equal(first.length, 1);
  assert.match(first[0] ?? "", /^text: the font "normal .*" has no glyph for "" \(U\+E000\); it draws as an empty box or nothing \(at test\/scene\/recorder\.checks\.test\.ts:\d+:\d+\)$/);
  assert.ok(!asked.includes(" "), "spaces draw nothing by design and are not asked about");
  assert.equal(glyphMessage("\u{1F600}", { style: "italic", family: "serif" }), 'text: the font "italic serif" has no glyph for "\u{1F600}" (U+1F600); it draws as an empty box or nothing');
});

test("missing glyph: the glyph atlas's rasteriser tells a private-use character from a letter", () => {
  const watch = new GlyphWatch((size) => createCanvas(size.width, size.height).getContext("2d"));
  const font = { style: "normal", family: "sans-serif" };
  assert.equal(watch.missing("a", font), false);
  assert.equal(watch.missing("", font), true);
});

test("removed calls: v.ctx, v.cache, v.sprite, v.image and v.paperTexture fail with RemovedCallError naming the replacement", () => {
  const rec = new SceneRecorder({ width: 10, height: 10 });
  for (const call of Object.keys(REPLACEMENTS)) {
    const member = call.slice(2);
    assert.throws(
      () =>
        rec.record((v) => {
          const got: unknown = Reflect.get(v, member);
          if (typeof got === "function") Reflect.apply(got, v, []);
        }),
      (e: unknown) => e instanceof RemovedCallError && e instanceof SketchUsageError && e.call === call && e.replacement.length > 0 && e.message.includes(`${call} was removed: `) && /(TEA|BRUSHES)\.md, "/.test(e.message),
      call,
    );
  }
});
