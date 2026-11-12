// Offscreen layers for the browser runtime: detached DOM canvases.
import type { Ctx2D, Layer, LayerImage } from "../../core/paint.js";
import { SketchUsageError } from "../../core/errors.js";

/** A detached `<canvas>` of `size` from `doc`, as a Painter layer. */
export function makeDomLayer(doc: Document, size: { width: number; height: number }): Layer {
  const canvas = doc.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new SketchUsageError({ detail: "this browser could not make an offscreen 2D canvas" });
  return {
    // eslint-disable-next-line no-restricted-syntax -- structural-context boundary: CanvasRenderingContext2D is a superset of Ctx2D (wider fillStyle union)
    ctx: ctx as unknown as Ctx2D,
    // eslint-disable-next-line no-restricted-syntax -- opaque-image boundary: an HTMLCanvasElement is what this runtime's drawImage accepts
    image: canvas as unknown as LayerImage,
  };
}
