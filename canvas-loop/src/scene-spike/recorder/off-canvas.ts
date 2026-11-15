// Testing mode: drawings that land entirely off the canvas, and unboxed text
// that crosses its edge (dev-loop row "offscreen", drawing-round finding 6).
//
// The rule: a sketch line is reported when everything it draws is off the
// canvas on every frame of the run. A thing that moves off and back, and a
// loop that draws past the edge (cobbles to x = 780 on a 720 canvas), are not
// reported: some of what the line draws is on the canvas on some frame. A
// drawing is the n-th checked call of a frame; its line is looked up on the
// first frame for every drawing, and after that only for drawings that are
// still candidates, so the stack is read rarely. Unboxed text that crosses
// the edge is reported per drawing, when it crosses on every frame.
//
// Bounds are conservative: a stroke's width, a brush's spread and the reach
// of effects on the shape and on every group around it count as drawn, so
// nothing whose ink can reach the canvas is reported. Pictures' bodies, mask
// artwork and shadow casters in a lit group (their shadow can land on the
// canvas) are not checked. One warning per run for each line, naming the
// frames.
import type { Effects } from "../../scene-draft/scene-api.js";
import { apply, maxScale } from "../mat.js";
import { sketchLine } from "../call-site.js";
import type { Geom, Mat, ShapeStyle } from "../scene.js";

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const r = (n: number): number => Math.round(n);
const boxText = (b: Box): string => `(${r(b.x0)},${r(b.y0)})–(${r(b.x1)},${r(b.y1)})`;

function boxOf(points: readonly (readonly [number, number])[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

/** A box around the shape's outline in its own coordinates (a path's control points bound its curves). */
function geomBox(g: Geom): Box {
  switch (g.kind) {
    case "rect":
      return boxOf([[g.x, g.y], [g.x + g.w, g.y + g.h]]);
    case "ellipse":
      return { x0: g.x - g.rx, y0: g.y - g.ry, x1: g.x + g.rx, y1: g.y + g.ry };
    case "arc":
      return { x0: g.x - g.r, y0: g.y - g.r, x1: g.x + g.r, y1: g.y + g.r };
    case "poly":
      return boxOf(g.points);
    case "path": {
      const pts: [number, number][] = [];
      for (const c of g.commands) for (let i = 1; i + 1 < c.length; i += 2) pts.push([Number(c[i]), Number(c[i + 1])]);
      return boxOf(pts);
    }
  }
}

/** How far effects can carry ink past what they apply to, in the coordinates they are called in. */
function effectsReach(e: Effects | undefined): number {
  if (e === undefined) return 0;
  const shadow = e.shadow === undefined ? 0 : Math.abs(e.shadow.x ?? 0) + Math.abs(e.shadow.y ?? 0) + 3 * (e.shadow.blur ?? 0);
  return Math.max(3 * (e.blur ?? 0), 3 * (e.glow?.blur ?? 0), shadow, (e.wash?.bleed ?? 0) * Math.SQRT2);
}

/** How far a shape's ink reaches past its outline: half the stroke (a miter can reach 5 weights), a brush's spread, its own effects. */
function shapeReach(s: ShapeStyle): number {
  const stroke = s.stroke === undefined && s.brush === undefined ? 0 : s.brush !== undefined ? 2 * s.weight : s.join === "miter" ? 5 * s.weight : s.weight;
  return stroke + effectsReach(s.effects);
}

/** One drawing's state on one frame. */
interface Seen {
  readonly what: string;
  readonly line: string;
  readonly box: Box;
  readonly crossing: boolean;
}

export class OffCanvas {
  readonly #canvas: { readonly width: number; readonly height: number };
  /** Drawings off the canvas (or crossing it) on every frame so far, by index; undefined before the first frame. */
  #kept: Map<number, Seen> | undefined;
  /** Lines that drew something on the canvas: on the first frame, or a candidate that came on later. */
  readonly #onCanvas = new Set<string>();
  #now = new Map<number, Seen>();
  #index = 0;
  #frames = 0;
  /** The frame's draw is running (control stand-ins, drawn after it, are not checked). */
  #open = false;
  /** The reach (canvas px) of the effects of the groups open around the current call. */
  #outer = 0;

  constructor(canvas: { width: number; height: number }) {
    this.#canvas = canvas;
  }

  begin(): void {
    this.#now = new Map();
    this.#index = 0;
    this.#open = true;
    this.#outer = 0;
  }

  /** A group with `effects` opens under `matrix`: what it draws can reach that much further. Returns what `leave` restores. */
  enter(effects: Effects | undefined, matrix: Mat): number {
    const outer = this.#outer;
    this.#outer += effectsReach(effects) * maxScale(matrix);
    return outer;
  }

  leave(outer: number): void {
    this.#outer = outer;
  }

  /** The frame's draw finished: keep only the drawings off the canvas on this frame too, from the same line. */
  end(): void {
    this.#open = false;
    const now = this.#now;
    this.#kept = this.#kept === undefined ? now : new Map([...this.#kept].filter(([i, s]) => {
      const n = now.get(i);
      const still = n !== undefined && n.line === s.line && n.crossing === s.crossing;
      if (!still && !s.crossing) this.#onCanvas.add(s.line);
      return still;
    }));
    this.#frames++;
  }

  /** A shape under `matrix` (to canvas coordinates); in a lit group (`lit`) a shadow caster is not checked. */
  shape(what: string, a: { geom: Geom; style: ShapeStyle; matrix: Mat; lit: boolean }): void {
    if (!this.#open || (a.lit && (a.style.material?.castsShadow ?? false) !== false)) return;
    const index = this.#index++;
    const b = geomBox(a.geom);
    const pad = shapeReach(a.style);
    const box = this.#toCanvas(a.matrix, { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad });
    if (this.#off(box)) this.#seen(index, { what, box, crossing: false });
    else this.#on();
  }

  /** Text's laid-out bounds (with any halo) under `matrix`; `unboxed` text that crosses the edge is reported too. */
  text(what: string, a: { bounds: { x: number; y: number; w: number; h: number; size: number }; matrix: Mat; unboxed: boolean }): void {
    if (!this.#open) return;
    const index = this.#index++;
    const t = a.bounds;
    const box = this.#toCanvas(a.matrix, { x0: t.x, y0: t.y, x1: t.x + t.w, y1: t.y + t.h });
    if (this.#off(box)) {
      this.#seen(index, { what, box, crossing: false });
      return;
    }
    if (a.unboxed && this.#outer === 0) {
      // The line box is taller than the ink: allow a fifth of the size above and below, and a pixel at the sides.
      const slack = 0.2 * t.size * maxScale(a.matrix);
      const { width, height } = this.#canvas;
      if (box.x0 < -1 || box.x1 > width + 1 || box.y0 < -slack || box.y1 > height + slack) this.#seen(index, { what, box, crossing: true });
    }
    this.#on();
  }

  #toCanvas(m: Mat, b: Box): Box {
    return boxOf([apply(m, [b.x0, b.y0]), apply(m, [b.x1, b.y0]), apply(m, [b.x0, b.y1]), apply(m, [b.x1, b.y1])]);
  }

  #off(b: Box): boolean {
    const { width, height } = this.#canvas;
    const outer = this.#outer;
    return b.x1 + outer <= 0 || b.y1 + outer <= 0 || b.x0 - outer >= width || b.y0 - outer >= height;
  }

  /** A drawing (partly) on the canvas: on the first frame, its line is not reported as off. */
  #on(): void {
    if (this.#kept === undefined) this.#onCanvas.add(sketchLine() ?? "");
  }

  #seen(index: number, s: { what: string; box: Box; crossing: boolean }): void {
    // The sketch's line is looked up only for a drawing that is still a candidate: on the first frame, or kept so far.
    // A candidate whose line drew on the canvas already is dropped without a lookup.
    if (this.#kept !== undefined) {
      const kept = this.#kept.get(index);
      if (kept === undefined || (!s.crossing && this.#onCanvas.has(kept.line))) return;
    }
    this.#now.set(index, { ...s, line: sketchLine() ?? "" });
  }

  /** After the run: one warning per sketch line whose drawings are all off the canvas on every frame, and per line with text crossing the edge on every frame. */
  warnings(): string[] {
    if (this.#kept === undefined) return [];
    const frames = this.#frames === 1 ? "on frame 0" : `on every frame (0–${this.#frames - 1})`;
    const byLine = new Map<string, Seen[]>();
    for (const s of this.#kept.values()) {
      if (!s.crossing && this.#onCanvas.has(s.line)) continue;
      const key = `${s.crossing ? "crossing" : "off"} ${s.line}`;
      byLine.set(key, [...(byLine.get(key) ?? []), s]);
    }
    const { width, height } = this.#canvas;
    const out: string[] = [];
    for (const list of byLine.values()) {
      const first = list[0];
      if (first === undefined) continue;
      const at = first.line === "" ? "" : ` (at ${first.line})`;
      const count = list.length === 1 ? first.what : `${list.length} drawings (${first.what}, …)`;
      out.push(first.crossing
        ? `${count} crosses the edge of the ${width}×${height} canvas ${frames}, at ${boxText(first.box)} in canvas coordinates, so part of it is cut off; move it inside, give it a box (w) to wrap in, or set keepInside${at}`
        : `${count} ${list.length === 1 ? "lands" : "land"} entirely off the ${width}×${height} canvas ${frames}, the first at ${boxText(first.box)} in canvas coordinates; check the translate, the units or the sign of its position (or, under a moving camera, run enough frames to reach it)${at}`);
    }
    return out;
  }
}
