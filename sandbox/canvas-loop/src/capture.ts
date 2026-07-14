import { createHash } from "node:crypto";
import { Canvas } from "@napi-rs/canvas";

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Content hash of a raw pixel buffer, used to skip re-encoding unchanged frames. */
export function hashPixels(pixels: Pixels): string {
  return createHash("sha1").update(Buffer.from(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength)).digest("hex");
}

/** Encode a raw pixel buffer to a deterministic PNG buffer via a scratch canvas. */
export function encodePng(pixels: Pixels): Buffer {
  const canvas = new Canvas(pixels.width, pixels.height);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(pixels.width, pixels.height);
  image.data.set(pixels.data);
  ctx.putImageData(image, 0, 0);
  return canvas.toBuffer("image/png");
}

/** Zero-padded frame filename, e.g. frame-0042.png. */
export function frameFileName(frame: number): string {
  return `frame-${String(frame).padStart(4, "0")}.png`;
}
