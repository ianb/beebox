import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Canvas } from "@napi-rs/canvas";
import { writeDiff } from "../../src/headless/diff.js";
import { tmpDir } from "../helpers.js";

function png(dir: string, args: { name: string; square: boolean }): string {
  const c = new Canvas(40, 30);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 40, 30);
  if (args.square) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(10, 5, 6, 4);
  }
  const path = join(dir, args.name);
  writeFileSync(path, c.toBuffer("image/png"));
  return path;
}

test("diff counts changed pixels, bounds them, and writes every view", async () => {
  const dir = tmpDir();
  const before = png(dir, { name: "a.png", square: false });
  const after = png(dir, { name: "b.png", square: true });
  const { stats, files } = await writeDiff(before, { after, outDir: join(dir, "out") });
  assert.equal(stats.changed, 24);
  assert.deepEqual(stats.bounds, { x: 10, y: 5, w: 6, h: 4 });
  for (const f of files) assert.ok(existsSync(join(dir, "out", f)), f);
});

test("erasing to transparent reads as lighter, and a rerun clears old change crops", async () => {
  const dir = tmpDir();
  const opaque = new Canvas(20, 20);
  const octx = opaque.getContext("2d");
  octx.fillStyle = "#000000";
  octx.fillRect(0, 0, 20, 20);
  const a = join(dir, "a.png");
  const b = join(dir, "b.png");
  writeFileSync(a, opaque.toBuffer("image/png"));
  writeFileSync(b, new Canvas(20, 20).toBuffer("image/png"));
  const out = join(dir, "out");
  await writeDiff(a, { after: b, outDir: out });
  const { loadImage } = await import("@napi-rs/canvas");
  const hl = await loadImage(join(out, "highlight.png"));
  const c = new Canvas(20, 20);
  const ctx = c.getContext("2d");
  ctx.drawImage(hl, 0, 0);
  assert.deepEqual([...ctx.getImageData(10, 10, 1, 1).data].slice(0, 3), [0, 170, 60], "green = got lighter");
  assert.ok(existsSync(join(out, "change-1.png")));
  await writeDiff(a, { after: a, outDir: out });
  assert.ok(!existsSync(join(out, "change-1.png")), "stale crop removed");
});
