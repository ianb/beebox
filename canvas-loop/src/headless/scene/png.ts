// Encode read-back pixels as PNG with @napi-rs/canvas (headless only).
import { createCanvas } from "@napi-rs/canvas";
import type { Pixels } from "../../gpu/renderer.js";

/** Premultiplied RGBA to the unpremultiplied bytes `ImageData` holds. */
export function unpremultiply(src: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i + 3 < src.length; i += 4) {
    const a = src[i + 3] ?? 0;
    out[i + 3] = a;
    if (a === 0) continue;
    for (let k = 0; k < 3; k++) out[i + k] = Math.round(((src[i + k] ?? 0) * 255) / a);
  }
  return out;
}

export function encodePng(px: Pixels): Buffer {
  const canvas = createCanvas(px.width, px.height);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(px.width, px.height);
  image.data.set(unpremultiply(px.data));
  ctx.putImageData(image, 0, 0);
  return canvas.toBuffer("image/png");
}
