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
