// Testing mode: drawings that land entirely off the canvas, and unboxed text
// that crosses its edge (dev-loop row "offscreen", drawing-round finding 6).
//
// The rule: a sketch line is reported when everything it draws is off the
// canvas on every frame of the run. A thing that moves off and back, and a
// loop that draws past the edge (cobbles to x = 780 on a 720 canvas), are not
// reported: some of what the line draws is on the canvas on some frame. A
// line with unboxed text crossing the edge on every frame is reported too.
// Each drawing's line comes from the stack, kept by its index in the frame
// and its call, so an unchanged frame reads no stacks; once no line is a
// candidate (after the first frame, candidates only drop out), nothing is
// looked up at all.
//
// Bounds are conservative: a stroke's width, a brush's spread and the reach
// of effects on the shape and on every group around it count as drawn, so
// nothing whose ink can reach the canvas is reported. Pictures' bodies, mask
// artwork and shadow casters in a lit group (their shadow can land on the
// canvas) are not checked; a placement counts the version's whole body
// (bounds.ts). One warning per run for each line, naming the
// frames. Under a moving camera the lines whose drawings moved but never
// reached the canvas join one summary warning (`offCanvasMessages`); a line
// whose drawing stayed put warns on its own.
import type { Effects } from "../../core/tea.js";
import { maxScale } from "../mat.js";
import { sketchLine } from "../call-site.js";
import type { Geom, Mat, PictureVersion, PixelsVersion, ShapeStyle } from "../nodes.js";
import type { Box } from "./bounds.js";
import { effectsReach, shapeBox, transformed, versionBox } from "./bounds.js";

const r = (n: number): number => Math.round(n);
const boxText = (b: Box): string => `(${r(b.x0)},${r(b.y0)})–(${r(b.x1)},${r(b.y1)})`;

/** What one line drew off the canvas (or across its edge) on the latest frame: how many, and the first. */
interface Seen {
  readonly what: string;
  readonly box: Box;
  count: number;
}

/** A line all of whose drawings were off the canvas on every frame: its latest frame's drawings, and whether its first drawing's box changed during the run. */
export interface OffLine extends Readonly<Seen> {
  readonly line: string;
  readonly moved: boolean;
}

const sameBox = (a: Box, b: Box): boolean => a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
const at = (line: string): string => (line === "" ? "" : ` (at ${line})`);

/** `89:5 (rect), 90:5 (circle) in path` for each file's lines, in the order first seen; a line not known is "an unknown line". */
function linesByFile(lines: readonly OffLine[]): string[] {
  const files = new Map<string, string[]>();
  for (const l of lines) {
    const m = /^(.*):(\d+:\d+)$/.exec(l.line);
    const [file, place] = m === null ? ["", l.line === "" ? "an unknown line" : l.line] : [m[1] ?? "", m[2] ?? ""];
    files.set(file, [...(files.get(file) ?? []), `${place} (${l.what})`]);
  }
  return [...files].map(([file, places]) => `${places.join(", ")}${file === "" ? "" : ` in ${file}`}`);
}

/**
 * The warnings for the lines drawn only off the canvas over a run of `frames`
 * frames: each line that never moved on its own, and the lines that moved
 * folded into one summary (a camera that has not reached them, or a wrong sign).
 */
export function offCanvasMessages(lines: readonly OffLine[], a: { canvas: { width: number; height: number }; frames: number }): string[] {
  const { width, height } = a.canvas;
  const span = a.frames === 1 ? "on frame 0" : `on every frame (0–${a.frames - 1})`;
  const out: string[] = [];
  for (const s of lines.filter((l) => !l.moved)) {
    const count = s.count === 1 ? `${s.what} lands` : `${s.count} drawings (${s.what}, …) land`;
    out.push(`${count} entirely off the ${width}×${height} canvas ${span}, the first at ${boxText(s.box)} in canvas coordinates; check the translate, the units or the sign of its position (or, under a moving camera, run enough frames to reach it)${at(s.line)}`);
  }
  const moving = lines.filter((l) => l.moved);
  if (moving.length > 0) {
    const one = moving.length === 1;
    const list = linesByFile(moving).join("; ");
    out.push(`${moving.length} ${one ? "line draws" : "lines draw"} only off the ${width}×${height} canvas while moving, on every frame 0–${a.frames - 1}: ${one ? "line" : "lines"} ${list}; a camera that has not reached ${one ? "it" : "them"}, or a wrong sign`);
  }
  return out;
}

export class OffCanvas {
  readonly #canvas: { readonly width: number; readonly height: number };
  /** Lines all off the canvas on every frame so far, and lines with text across its edge on every frame; undefined before the first frame. */
  #off: Set<string> | undefined;
  #crossing: Set<string> | undefined;
  /** Lines that drew something on the canvas, on any frame. */
  readonly #onCanvas = new Set<string>();
  /** Each off line's first drawing's box on the first frame it was off, and the lines whose box has changed since. */
  readonly #firstBox = new Map<string, Box>();
  readonly #moved = new Set<string>();
  /** This frame: lines with a drawing off the canvas, and with text across its edge, with their first drawing. */
  #offNow = new Map<string, Seen>();
  #crossingNow = new Map<string, Seen>();
  /** Each index's call and line as last looked up: a later frame's drawing with the same call takes it without a lookup. */
  readonly #lineAt = new Map<number, { what: string; line: string }>();
  #index = 0;
  #frames = 0;
  /** The frame's draw is running (control stand-ins, drawn after it, are not checked). */
  #open = false;
  /** The reach (canvas px) of the effects of the groups open around the current call. */
  #outer = 0;

  constructor(canvas: { width: number; height: number }) {
    this.#canvas = canvas;
  }

  /** Whether a line can still be reported: on the first frame, or while a candidate is left. */
  get #pending(): boolean {
    return this.#off === undefined || this.#off.size > 0 || (this.#crossing?.size ?? 0) > 0;
  }

  begin(): void {
    this.#offNow = new Map();
    this.#crossingNow = new Map();
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

  /** The frame's draw finished: a candidate stays one only if it was off (or across the edge) on this frame too. */
  end(): void {
    this.#open = false;
    const keep = (was: Set<string> | undefined, now: Map<string, Seen>): Set<string> => new Set([...now.keys()].filter((l) => was === undefined || was.has(l)));
    this.#off = new Set([...keep(this.#off, this.#offNow)].filter((l) => !this.#onCanvas.has(l)));
    this.#crossing = keep(this.#crossing, this.#crossingNow);
    for (const line of this.#off) {
      const box = this.#offNow.get(line)?.box;
      const first = this.#firstBox.get(line);
      if (box === undefined) continue;
      if (first === undefined) this.#firstBox.set(line, box);
      else if (!sameBox(first, box)) this.#moved.add(line);
    }
    this.#frames++;
  }

  /** A shape under `matrix` (to canvas coordinates); in a lit group (`lit`) a shadow caster is not checked. */
  shape(what: string, a: { geom: Geom; style: ShapeStyle; matrix: Mat; lit: boolean }): void {
    if (!this.#open || (a.lit && (a.style.material?.castsShadow ?? false) !== false)) return;
    this.#drawing(what, { box: transformed(a.matrix, shapeBox(a.geom, a.style)), crossing: false });
  }

  /** A placement: the version's whole body under `matrix` (the placement's). One holding a light or a shadow caster can reach anywhere and is not checked. */
  place(what: string, a: { version: PictureVersion | PixelsVersion; matrix: Mat }): void {
    if (!this.#open) return;
    const body = versionBox(a.version);
    if (body !== undefined) this.#drawing(what, { box: transformed(a.matrix, body), crossing: false });
  }

  /** Text's laid-out bounds (with any halo) under `matrix`; `unboxed` text that crosses the edge is reported too. */
  text(what: string, a: { bounds: { x: number; y: number; w: number; h: number; size: number }; matrix: Mat; unboxed: boolean }): void {
    if (!this.#open) return;
    const t = a.bounds;
    const box = transformed(a.matrix, { x0: t.x, y0: t.y, x1: t.x + t.w, y1: t.y + t.h });
    // The line box is taller than the ink: allow a fifth of the size above and below, and a pixel at the sides.
    const slack = 0.2 * t.size * maxScale(a.matrix);
    const { width, height } = this.#canvas;
    const crossing = a.unboxed && this.#outer === 0 && (box.x0 < -1 || box.x1 > width + 1 || box.y0 < -slack || box.y1 > height + slack);
    this.#drawing(what, { box, crossing });
  }

  #drawing(what: string, a: { box: Box; crossing: boolean }): void {
    const index = this.#index++;
    if (!this.#pending) return;
    const line = this.#lineOf(index, what);
    const off = this.#isOff(a.box);
    if (!off) this.#onCanvas.add(line);
    for (const [hit, into] of [[off, this.#offNow], [!off && a.crossing, this.#crossingNow]] as const) {
      if (!hit) continue;
      const seen = into.get(line);
      if (seen === undefined) into.set(line, { what, box: a.box, count: 1 });
      else seen.count++;
    }
  }

  #isOff(b: Box): boolean {
    const { width, height } = this.#canvas;
    const outer = this.#outer;
    return b.x1 + outer <= 0 || b.y1 + outer <= 0 || b.x0 - outer >= width || b.y0 - outer >= height;
  }

  #lineOf(index: number, what: string): string {
    const known = this.#lineAt.get(index);
    if (known?.what === what) return known.line;
    const line = sketchLine() ?? "";
    this.#lineAt.set(index, { what, line });
    return line;
  }

  /** After the run: the warnings for lines whose drawings were all off the canvas on every frame (`offCanvasMessages`), and one per line with text across its edge on every frame. */
  warnings(): string[] {
    const frames = this.#frames === 1 ? "on frame 0" : `on every frame (0–${this.#frames - 1})`;
    const { width, height } = this.#canvas;
    const off: OffLine[] = [];
    for (const line of this.#off ?? []) {
      const s = this.#offNow.get(line);
      if (s !== undefined && !this.#onCanvas.has(line)) off.push({ ...s, line, moved: this.#moved.has(line) });
    }
    const out = offCanvasMessages(off, { canvas: this.#canvas, frames: this.#frames });
    for (const line of this.#crossing ?? []) {
      const s = this.#crossingNow.get(line);
      if (s === undefined) continue;
      out.push(`${s.what} crosses the edge of the ${width}×${height} canvas ${frames}, at ${boxText(s.box)} in canvas coordinates, so part of it is cut off; move it inside, give it a box (w) to wrap in, or set keepInside${at(line)}`);
    }
    return out;
  }
}
