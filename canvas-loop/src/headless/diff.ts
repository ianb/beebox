// EXPERIMENTAL: `cli diff <before.png> <after.png>` — several views of what
// changed between two frames, for the open question "how should an agent see
// whether its change helped?". Writes every view; which ones to keep is
// decided by the diff exploration (see the canvas-brushes plan).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Canvas, loadImage } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";
import { CliError } from "./errors.js";

interface Frame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  readonly canvas: Canvas;
}

/** Summary numbers for a pair of frames. */
export interface DiffStats {
  readonly changed: number;
  readonly total: number;
  readonly bounds: { x: number; y: number; w: number; h: number } | undefined;
  readonly meanDelta: number;
}

/** A pixel counts as changed when any channel moves by more than this. */
const THRESHOLD = 8;

async function loadFrame(path: string): Promise<Frame> {
  const image = await loadImage(path);
  const canvas = new Canvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, data, canvas };
}

function changedMask(a: Frame, b: Frame): { mask: Uint8Array; stats: DiffStats } {
  const mask = new Uint8Array(a.width * a.height);
  let changed = 0;
  let deltaSum = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < mask.length; i += 1) {
    let d = 0;
    for (let c = 0; c < 4; c += 1) d = Math.max(d, Math.abs((a.data[i * 4 + c] ?? 0) - (b.data[i * 4 + c] ?? 0)));
    deltaSum += d;
    if (d > THRESHOLD) {
      mask[i] = 1;
      changed += 1;
      const x = i % a.width;
      const y = Math.floor(i / a.width);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  const bounds = changed === 0 ? undefined : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  return { mask, stats: { changed, total: mask.length, bounds, meanDelta: deltaSum / mask.length } };
}

function label(ctx: SKRSContext2D, args: { text: string; x: number; y: number }): void {
  ctx.font = "14px sans-serif";
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillRect(args.x, args.y, ctx.measureText(args.text).width + 12, 22);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(args.text, args.x + 6, args.y + 16);
}

function sideBySide(a: Frame, b: Frame): Buffer {
  const gap = 8;
  const out = new Canvas(a.width * 2 + gap, a.height);
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(a.canvas, 0, 0);
  ctx.drawImage(b.canvas, a.width + gap, 0);
  label(ctx, { text: "before", x: 4, y: 4 });
  label(ctx, { text: "after", x: a.width + gap + 4, y: 4 });
  return out.toBuffer("image/png");
}

function highlight(b: Frame, mask: Uint8Array): Buffer {
  const out = new Canvas(b.width, b.height);
  const ctx = out.getContext("2d");
  const image = ctx.createImageData(b.width, b.height);
  for (const [i, m] of mask.entries()) {
    const grey = ((b.data[i * 4] ?? 0) + (b.data[i * 4 + 1] ?? 0) + (b.data[i * 4 + 2] ?? 0)) / 3;
    const faded = 200 + grey * 0.2;
    const hit = m === 1;
    image.data[i * 4] = hit ? 230 : faded;
    image.data[i * 4 + 1] = hit ? 0 : faded;
    image.data[i * 4 + 2] = hit ? 160 : faded;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return out.toBuffer("image/png");
}

function cropPair(a: Frame, args: { b: Frame; bounds: NonNullable<DiffStats["bounds"]> }): Buffer {
  const pad = 12;
  const x = Math.max(0, args.bounds.x - pad);
  const y = Math.max(0, args.bounds.y - pad);
  const w = Math.min(a.width - x, args.bounds.w + pad * 2);
  const h = Math.min(a.height - y, args.bounds.h + pad * 2);
  const scale = Math.max(1, Math.min(4, Math.floor(480 / Math.max(w, h))));
  const gap = 8;
  const out = new Canvas(w * scale * 2 + gap, h * scale);
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(a.canvas, x, y, w, h, 0, 0, w * scale, h * scale);
  ctx.drawImage(args.b.canvas, x, y, w, h, w * scale + gap, 0, w * scale, h * scale);
  label(ctx, { text: `before ×${scale}`, x: 4, y: 4 });
  label(ctx, { text: `after ×${scale}`, x: w * scale + gap + 4, y: 4 });
  return out.toBuffer("image/png");
}

/** One line of numbers about the change. */
export function statsLine(stats: DiffStats): string {
  const pct = ((100 * stats.changed) / stats.total).toFixed(1);
  const where = stats.bounds === undefined ? "nothing changed" : `changed area x=${stats.bounds.x} y=${stats.bounds.y} ${stats.bounds.w}×${stats.bounds.h}`;
  return `${stats.changed} px changed (${pct}%), ${where}, mean channel delta ${stats.meanDelta.toFixed(2)}`;
}

/** Write every diff view of `before` → `after` into `outDir`; returns the file names and stats. */
export async function writeDiff(before: string, args: { after: string; outDir: string }): Promise<{ files: string[]; stats: DiffStats }> {
  const a = await loadFrame(before);
  const b = await loadFrame(args.after);
  if (a.width !== b.width || a.height !== b.height) {
    throw new CliError({ detail: `diff needs frames of the same size (${a.width}×${a.height} vs ${b.width}×${b.height})` });
  }
  const { mask, stats } = changedMask(a, b);
  mkdirSync(args.outDir, { recursive: true });
  const files: [string, Buffer][] = [
    ["side-by-side.png", sideBySide(a, b)],
    ["highlight.png", highlight(b, mask)],
  ];
  if (stats.bounds !== undefined) files.push(["changed-crop.png", cropPair(a, { b, bounds: stats.bounds })]);
  for (const [name, buf] of files) writeFileSync(join(args.outDir, name), buf);
  writeFileSync(join(args.outDir, "stats.txt"), `${statsLine(stats)}\n`);
  return { files: [...files.map(([name]) => name), "stats.txt"], stats };
}
