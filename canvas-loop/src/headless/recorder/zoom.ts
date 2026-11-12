// Zoomed crops: an enlarged view of one region of a frame, with nearest-pixel
// scaling so texture, grain and antialiasing show as they are. Drawers cannot
// judge brush texture from a whole frame at 1×; a crop at 3× shows it.
import { Canvas } from "@napi-rs/canvas";
import { CliError } from "../errors.js";
import type { Pixels } from "./capture.js";

/** One crop region, in canvas pixels, and its enlargement. */
export interface Zoom {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly scale: number;
}

const DEFAULT_SCALE = 3;
const MAX_OUTPUT_SIDE = 2400;

/** Parse `x,y,w,h` or `x,y,w,h@scale` (scale defaults to 3). */
export function parseZoom(spec: string): Zoom {
  const [rect = "", scaleText] = spec.split("@");
  const parts = rect.split(",").map((p) => Number(p.trim()));
  const scale = scaleText === undefined ? DEFAULT_SCALE : Number(scaleText);
  const [x, y, w, h] = parts;
  if (parts.length !== 4 || x === undefined || y === undefined || w === undefined || h === undefined || !parts.every(Number.isInteger)) {
    throw new CliError({ detail: `--zoom "${spec}" must be x,y,w,h in whole pixels, optionally @scale (e.g. 90,80,160,120@3)` });
  }
  if (w <= 0 || h <= 0 || !Number.isFinite(scale) || scale < 1 || scale > 16) {
    throw new CliError({ detail: `--zoom "${spec}" needs a positive width and height and a scale from 1 to 16` });
  }
  if (Math.max(w, h) * scale > MAX_OUTPUT_SIDE) {
    throw new CliError({ detail: `--zoom "${spec}" would be over ${MAX_OUTPUT_SIDE}px on a side; crop smaller or lower the scale` });
  }
  return { x, y, w, h, scale };
}

/** A short label for transcripts: `90,80 160×120 ×3`. */
export function zoomLabel(zoom: Zoom): string {
  return `${zoom.x},${zoom.y} ${zoom.w}×${zoom.h} ×${zoom.scale}`;
}

/** Encode the zoomed crop of `pixels` as a PNG (regions past the edge are transparent). */
export function encodeZoomPng(pixels: Pixels, zoom: Zoom): Buffer {
  const source = new Canvas(pixels.width, pixels.height);
  const sctx = source.getContext("2d");
  const image = sctx.createImageData(pixels.width, pixels.height);
  image.data.set(pixels.data);
  sctx.putImageData(image, 0, 0);
  const out = new Canvas(Math.round(zoom.w * zoom.scale), Math.round(zoom.h * zoom.scale));
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, zoom.x, zoom.y, zoom.w, zoom.h, 0, 0, out.width, out.height);
  return out.toBuffer("image/png");
}

/** `frame-0012-zoom1.png` for the first zoom of frame 12. */
export function zoomFileName(frame: number, index: number): string {
  return `frame-${String(frame).padStart(4, "0")}-zoom${index + 1}.png`;
}
