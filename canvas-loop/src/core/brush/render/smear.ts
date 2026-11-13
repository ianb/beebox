// Smudge and wet paint: dabs that move the drawing under the brush.
//
// The brush carries a small square patch of pixels, its load. At each dab the
// load is first mixed with the drawing under the dab (it keeps `strength` of
// itself) and, for wet paint, with the stroke colour (`color`), then laid down
// through the tip. Mixing before laying means `strength: 0` lays down exactly
// what is already there: no change. A smudge picks up the live drawing, so it keeps dragging what it
// has already smeared, as a finger does. Wet paint picks up from a copy taken
// before the stroke: picking up its own fresh paint would turn it into flat
// stroke colour. Everything moves with drawImage between canvases, in
// device pixels with identity transforms, so a browser never reads pixels
// back. Mixing is an exact premultiplied lerp: scale by `destination-in`
// with a uniform alpha, then add with `lighter`.
import { SketchUsageError } from "../../errors.js";
import { cssColour, parseColour } from "./colour.js";
import type { Ctx2D, Layer, LayerImage } from "../../paint.js";
import { withSaved } from "../../paint.js";
import type { Sample } from "../sample.js";
import type { SmearBrush } from "../types.js";

export interface SmearRequest {
  /** The surface the mark lands on, and its image, which the brush picks up from. */
  readonly target: Ctx2D;
  readonly targetImage: LayerImage;
  /** Two reusable layers at least as big as one dab's patch: the load and the dab. */
  readonly load: Layer;
  readonly dab: Layer;
  /** A canvas-sized layer for wet paint's copy of the drawing taken before the stroke. */
  readonly before: Layer;
  readonly paint: string | undefined;
  readonly brush: SmearBrush;
  readonly composite: string;
  /** Device-pixel samples per contour, with pressure. */
  readonly contours: readonly (readonly Sample[])[];
  /** Stroke width in device pixels at full pressure. */
  readonly width: number;
  readonly paper: () => Layer;
  /** The target's size in device pixels: pickup near an edge reads the nearest patch inside it. */
  readonly canvas: { readonly width: number; readonly height: number };
}

/** Scale every pixel (premultiplied) of the patch by `keep`, then add `add` at `amount`. */
function mix(ctx: Ctx2D, args: { size: number; keep: number; add: () => void }): void {
  const { size } = args;
  ctx.globalCompositeOperation = "destination-in";
  ctx.globalAlpha = 1;
  ctx.fillStyle = `rgba(0, 0, 0, ${args.keep})`;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "lighter";
  args.add();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

function checkSmear(req: SmearRequest): void {
  if (req.composite !== "source-over") {
    throw new SketchUsageError({ detail: `a ${req.brush.color > 0 ? "wet" : "smudge"} brush cannot erase or blend; draw it with the normal blend` });
  }
  if (req.brush.color > 0 && req.paint === undefined) {
    throw new SketchUsageError({ detail: "a smear brush with color above 0 (wet paint) needs a solid stroke colour, not a gradient" });
  }
}

/** Wet paint's colour, checked: a colour the runtime cannot read is an error, not black. */
function wetColour(req: SmearRequest): string | undefined {
  if (req.brush.color === 0 || req.paint === undefined) return undefined;
  return cssColour(parseColour(req.load.ctx, req.paint), 1);
}

/**
 * One dab: move the target toward the load through the tip at (x, y), radius r, by alpha.
 * An exact premultiplied lerp, so a translucent drawing stays as translucent as the paint
 * moved into it: erase the target by the tip mask (destination-out), then add the masked
 * load (lighter). The dab layer holds the masked load at [0, size) and the mask at [size, 2·size).
 */
function layDab(req: SmearRequest, dab: { x: number; y: number; r: number; alpha: number; size: number }): void {
  const { size } = dab;
  const half = size / 2;
  const left = Math.round(dab.x - half);
  const top = Math.round(dab.y - half);
  const cx = dab.x - left;
  const cy = dab.y - top;
  const d = req.dab.ctx;
  d.clearRect(0, 0, 2 * size, size);
  // The tip as a radial gradient: soft fades from the centre; hard keeps a one-pixel antialiased edge.
  const g = d.createRadialGradient(cx + size, cy, 0, cx + size, cy, dab.r);
  g.addColorStop(req.brush.tip === "soft" ? 0 : Math.max(0, (dab.r - 1) / dab.r), "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  d.fillStyle = g;
  d.fillRect(size, 0, size, size);
  if (req.brush.grain > 0) {
    d.globalCompositeOperation = "destination-out";
    d.globalAlpha = req.brush.grain;
    d.drawImage(req.paper().image, left, top, size, size, size, 0, size, size);
    d.globalAlpha = 1;
  }
  const t = req.target;
  t.globalAlpha = dab.alpha * req.brush.opacity;
  t.globalCompositeOperation = "destination-out";
  t.drawImage(req.dab.image, size, 0, size, size, left, top, size, size);
  // Mask the load only now: a browser's destination-in also clears outside the drawn rect,
  // which takes the mask with it.
  d.globalCompositeOperation = "source-over";
  d.drawImage(req.load.image, 0, 0, size, size, 0, 0, size, size);
  d.globalCompositeOperation = "destination-in";
  d.drawImage(req.dab.image, size, 0, size, size, 0, 0, size, size);
  d.globalCompositeOperation = "source-over";
  t.globalCompositeOperation = "lighter";
  t.drawImage(req.dab.image, 0, 0, size, size, left, top, size, size);
  t.globalCompositeOperation = "source-over";
}

/** Mix the load with what is under (x, y) now, and with the stroke colour for wet paint. */
function pickUp(req: SmearRequest, at: { x: number; y: number; size: number; keep: number }): void {
  const { size } = at;
  // Off the canvas there is nothing to pick up; reading transparency there would make a smudge
  // that starts past an edge erase what it crosses. Read the nearest patch inside instead.
  const clamp = (v: number, extent: number): number => Math.max(0, Math.min(Math.max(0, extent - size), v));
  const left = clamp(Math.round(at.x - size / 2), req.canvas.width);
  const top = clamp(Math.round(at.y - size / 2), req.canvas.height);
  const l = req.load.ctx;
  mix(l, {
    size,
    keep: at.keep,
    add: () => {
      l.globalAlpha = 1 - at.keep;
      l.drawImage(req.brush.color > 0 ? req.before.image : req.targetImage, left, top, size, size, 0, 0, size, size);
    },
  });
  const color = req.brush.color;
  const paint = req.paint;
  if (color > 0 && paint !== undefined) {
    mix(l, {
      size,
      keep: 1 - color,
      add: () => {
        l.globalAlpha = color;
        l.fillStyle = paint;
        l.fillRect(0, 0, size, size);
      },
    });
  }
}

function smearContour(req: SmearRequest, samples: readonly Sample[]): void {
  const { brush } = req;
  // An even patch size keeps the tip centred on a pixel boundary at every dab.
  const size = 2 * Math.ceil(req.width / 2) + 4;
  for (const [k, s] of samples.entries()) {
    // The first dab starts from a load of what lies under it (all paint when color is 1).
    if (k === 0) req.load.ctx.clearRect(0, 0, size, size);
    pickUp(req, { x: s.x, y: s.y, size, keep: k === 0 ? 0 : brush.strength });
    const r = (req.width / 2) * (1 - brush.sizeByPressure * (1 - s.p));
    const alpha = brush.flow * (1 - brush.opacityByPressure * (1 - s.p));
    if (r > 0.05 && alpha > 0) layDab(req, { x: s.x, y: s.y, r, alpha, size });
  }
}

/** Copy the part of the target the stroke can reach onto `before`, at the same coordinates. */
function copyBefore(req: SmearRequest): void {
  const pad = req.width + 4;
  const all = req.contours.flat();
  const x0 = Math.floor(Math.min(...all.map((s) => s.x)) - pad);
  const y0 = Math.floor(Math.min(...all.map((s) => s.y)) - pad);
  const x1 = Math.ceil(Math.max(...all.map((s) => s.x)) + pad);
  const y1 = Math.ceil(Math.max(...all.map((s) => s.y)) + pad);
  const b = req.before.ctx;
  b.clearRect(x0, y0, x1 - x0, y1 - y0);
  b.drawImage(req.targetImage, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
}

/** Paint a smear mark straight onto the target, dab by dab. */
export function renderSmear(given: SmearRequest): void {
  checkSmear(given);
  if (given.contours.flat().length === 0) return;
  const req = { ...given, paint: wetColour(given) };
  for (const layer of [req.load, req.dab, req.before]) {
    layer.ctx.save();
    layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  try {
    if (req.brush.color > 0) copyBefore(req);
    withSaved(req.target, () => {
      req.target.setTransform(1, 0, 0, 1, 0, 0);
      req.target.globalCompositeOperation = "source-over";
      for (const samples of req.contours) smearContour(req, samples);
    });
  } finally {
    for (const layer of [req.load, req.dab, req.before]) layer.ctx.restore();
  }
}
