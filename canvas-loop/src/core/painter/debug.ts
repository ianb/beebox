// Debug outlines (`run --outline`): where sprites were placed, where clips cut,
// and boxes the sketch asked to see (hit areas). Collected while a frame is
// drawn, in canvas coordinates, and drawn over the finished frame.
import { pathContours } from "../contours.js";
import type { ClipShape, Ctx2D, CtxTransform, Vec2 } from "../paint.js";
import { isPathShape } from "../paint.js";

type Kind = "sprite" | "clip" | "box";

const COLORS: Record<Kind, string> = { sprite: "#ff00aa", clip: "#00c8ff", box: "#ffd000" };

interface Outline {
  readonly kind: Kind;
  readonly label: string;
  readonly points: readonly Vec2[];
}

/** The point lists to outline: a rectangle, or each piece of a clip shape. */
export function outlinePoints(args: { rect?: readonly [number, number, number, number]; shape?: ClipShape }): Vec2[][] {
  if (args.shape !== undefined) return isPathShape(args.shape) ? pathContours(args.shape, 1).map((c) => [...c.points]) : [[...args.shape]];
  const [x, y, w, h] = args.rect ?? [0, 0, 0, 0];
  return [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]];
}

/** Map points through a transform into canvas coordinates. */
export function toCanvas(m: CtxTransform, points: readonly Vec2[]): Vec2[] {
  return points.map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
}

export class DebugOverlay {
  readonly enabled: boolean;
  #outlines: Outline[] = [];

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  add(outline: Outline): void {
    if (this.enabled) this.#outlines.push(outline);
  }

  /** Draw this frame's outlines over `ctx` (canvas coordinates), then forget them. */
  draw(ctx: Ctx2D): void {
    if (this.#outlines.length === 0) return;
    ctx.save();
    ctx.resetTransform();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = 1.5;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    for (const { kind, label, points } of this.#outlines) {
      const [first, ...rest] = points;
      if (first === undefined) continue;
      ctx.strokeStyle = COLORS[kind];
      ctx.beginPath();
      ctx.moveTo(first[0], first[1]);
      for (const [x, y] of rest) ctx.lineTo(x, y);
      ctx.closePath();
      ctx.stroke();
      // A see-through tag, so the label does not hide the art it names.
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(first[0], first[1] - 12, label.length * 5.6 + 6, 12);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, first[0] + 3, first[1] - 11);
    }
    ctx.restore();
    this.#outlines = [];
  }
}
