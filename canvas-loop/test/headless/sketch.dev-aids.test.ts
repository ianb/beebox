// The development aids from the busy-town round: outlines, timing, faint-mark
// context and opt-out, fonts, typed records, tuples through DeepReadonly.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeepReadonly, Vec2 } from "../../src/core/tea.js";
import { Sketch } from "../../src/headless/sketch.js";
import { TeaUtil } from "../../src/headless/tea-view.js";
import { run } from "../../src/headless/runtime.js";
import { readTranscript, runOptions, tmpDir } from "../helpers.js";

function makeSketch(args: { outline: boolean; logs?: string[] }): Sketch {
  const logs = args.logs ?? [];
  const s = new Sketch({
    host: { recordLog: (e) => logs.push(e.message), requestSnapshot(): void {} },
    seed: 42,
    fps: 60,
    onHandled: () => {},
    outline: args.outline,
  });
  s.createCanvas(60, 40);
  return s;
}

function alphaAt(s: Sketch, at: readonly [number, number]): number {
  const { data, width } = s.readPixels();
  return data[(at[1] * width + at[0]) * 4 + 3] ?? 0;
}

test("debugBox draws only with outlines on, after the frame finishes", () => {
  for (const outline of [false, true]) {
    const s = makeSketch({ outline });
    s.debugBox("hit", 10, 20, 30, 15);
    s.finishFrame();
    assert.equal(alphaAt(s, [25, 35]) > 0, outline, `outline=${outline}`);
  }
});

test("a faint mark in a sprite names the sprite; gesture({ faint: true }) silences it", () => {
  const logs: string[] = [];
  const s = makeSketch({ outline: false, logs });
  const faintLine = (): void => {
    s.stroke("rgba(0,0,0,0.03)");
    s.strokeWeight(6);
    s.brush("ink");
    s.line(5, 5, 25, 5);
  };
  s.sprite({ key: "ghost", width: 30, height: 10 }, faintLine);
  assert.match(logs[0] ?? "", /in sprite "ghost"/);
  s.gesture({ faint: true });
  faintLine();
  assert.equal(logs.length, 1);
});

test("--timing adds one timing line to the transcript", () => {
  const outDir = tmpDir();
  const module = { setup: (s: Sketch): void => s.createCanvas(10, 10), draw: (s: Sketch): void => s.background("#000") };
  run(runOptions(module, { outDir, frames: 5, timing: true }));
  assert.match(readTranscript(outDir), /timing: draw avg [\d.]+ ms, p95 [\d.]+ ms, max [\d.]+ ms; frame 0 draw/);
});

test("u.record builds a typed record; DeepReadonly keeps tuples as tuples", () => {
  const s = makeSketch({ outline: false });
  const u = new TeaUtil({ sketch: s, getParams: () => ({}), onHandled: () => {} });
  const counts = u.record(["a", "b"] as const, () => 0);
  assert.deepEqual(counts, { a: 0, b: 0 });
  const point: DeepReadonly<Vec2> = [1, 2];
  const back: Vec2 = point; // compiles only if DeepReadonly<Vec2> stays a tuple
  assert.equal(back[1], 2);
});

test("textFont and textStyle reach the context's font", () => {
  const s = makeSketch({ outline: false });
  s.textFont("Georgia, serif");
  s.textStyle("italic");
  s.textSize(14);
  s.text("hi", 5, 20);
  assert.match(s.ctx.font, /italic/);
});
