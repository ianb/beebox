// The development aids from the busy-town round: outlines, timing, faint-mark
// context and opt-out, fonts, typed records, tuples through DeepReadonly.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeepReadonly, Vec2, View } from "../../src/core/tea.js";
import { toTeaModule } from "../../src/headless/tea-load.js";
import { teaRun } from "../../src/headless/tea-runtime.js";
import { readTranscript, teaRunOptions, teaView, tmpDir } from "../helpers.js";

test("debugBox draws only with outlines on, after the frame finishes", () => {
  for (const outline of [false, true]) {
    const { v, finishFrame, alpha } = teaView({ width: 60, height: 40 }, { seed: 42, outline });
    v.debugBox("hit", 10, 20, 30, 15);
    finishFrame();
    assert.equal(alpha(25, 35) > 0, outline, `outline=${outline}`);
  }
});

test("a faint mark in a sprite names the sprite; gesture({ faint: true }) silences it", () => {
  const { v, logs } = teaView({ width: 60, height: 40 }, { seed: 42 });
  const faintLine = (gesture: { faint?: boolean }): void => {
    v.line(5, 5, 25, 5, { stroke: "rgba(0,0,0,0.03)", weight: 6, brush: "ink", gesture });
  };
  v.sprite({ key: "ghost", width: 30, height: 10 }, () => faintLine({}));
  assert.match(logs[0] ?? "", /in sprite "ghost"/);
  faintLine({ faint: true });
  assert.equal(logs.length, 1);
});

test("--timing adds one timing line to the transcript", () => {
  const outDir = tmpDir();
  const module = toTeaModule({
    canvas: { width: 10, height: 10 },
    init: () => ({}),
    update: (model: object) => model,
    draw: (v: View): void => v.background("#000"),
  });
  teaRun(teaRunOptions(module, { outDir, frames: 5, timing: true }));
  assert.match(readTranscript(outDir), /timing: draw avg [\d.]+ ms, p95 [\d.]+ ms, max [\d.]+ ms \(frame \d+\); update avg [^;]+; frame 0 draw/);
});

test("u.record builds a typed record; DeepReadonly keeps tuples as tuples", () => {
  const { u } = teaView({ width: 60, height: 40 }, { seed: 42 });
  const counts = u.record(["a", "b"] as const, () => 0);
  assert.deepEqual(counts, { a: 0, b: 0 });
  const point: DeepReadonly<Vec2> = [1, 2];
  const back: Vec2 = point; // compiles only if DeepReadonly<Vec2> stays a tuple
  assert.equal(back[1], 2);
});

test("text font and style options reach the context's font while the text draws", () => {
  const { v } = teaView({ width: 60, height: 40 }, { seed: 42 });
  const fonts: string[] = [];
  const { ctx } = v;
  const fillText = ctx.fillText.bind(ctx);
  ctx.fillText = (...args: Parameters<typeof fillText>): void => {
    fonts.push(ctx.font);
    fillText(...args);
  };
  v.text("hi", { x: 5, y: 20 }, { font: "Georgia, serif", style: "italic", size: 14, valign: "baseline" });
  assert.match(fonts[0] ?? "", /italic/);
  assert.match(fonts[0] ?? "", /Georgia/);
});
