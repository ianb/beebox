import type { SKRSContext2D } from "@napi-rs/canvas";
import { controlModels } from "../browser/controls-model.js";
import type { ControlModel } from "../browser/controls-model.js";
import type { Style } from "../core/paint.js";
import type { Painter } from "../core/painter/engine.js";
import { PainterView } from "../core/view.js";
import { recordOf } from "../core/records.js";
import type { ControlBox, CursorKind, ParamsDecl, ParamValues, Util, View } from "../core/tea.js";
import { SketchUsageError } from "./errors.js";
import type { Surface } from "./surface.js";

// ── control stand-ins: a plain field showing the param's value, so headless
// frames show where the browser's native input will sit and what it holds.

const NATURAL_HEIGHT = 24;
const DEFAULT_SIZE = 14;

function shown(model: ControlModel): string {
  switch (model.kind) {
    case "number":
      return String(model.value);
    case "select":
      return model.value;
    case "trigger":
      return model.label;
    case "boolean":
      return "";
  }
}

const FIELD: Style = { fill: "#ffffff", stroke: "#767676", weight: 1 };
const BUTTON: Style = { ...FIELD, fill: "#efefef" };
const MARK: Style = { stroke: "#222222", weight: 1.75 };

/** Draw `model`'s stand-in in `box`; explicit styles, so the sketch's state is untouched. */
function drawStandIn(painter: Painter, at: { box: ControlBox; model: ControlModel }): void {
  const { box, model } = at;
  const h = box.h ?? NATURAL_HEIGHT;
  if (model.kind === "boolean") {
    const side = Math.min(h, 16);
    const x = box.x + 1;
    const y = box.y + (h - side) / 2;
    painter.roundRect(x + 0.5, y + 0.5, side - 1, side - 1, 3, FIELD);
    if (model.value) painter.path([["move", x + side * 0.22, y + side * 0.52], ["line", x + side * 0.42, y + side * 0.72], ["line", x + side * 0.78, y + side * 0.28]], MARK);
    return;
  }
  const button = model.kind === "trigger";
  painter.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, h - 1, 3, button ? BUTTON : FIELD);
  const select = model.kind === "select";
  const cx = box.x + box.w - 12;
  const cy = box.y + h / 2;
  if (select) painter.path([["move", cx - 4, cy - 2], ["line", cx, cy + 2], ["line", cx + 4, cy - 2]], MARK);
  painter.text(shown(model), { x: box.x + 6, y: box.y, w: box.w - 6 - (select ? 22 : 6), h }, {
    align: button ? "center" : (box.align ?? "left"),
    valign: "middle",
    wrap: false,
    fit: true,
    size: box.size ?? DEFAULT_SIZE,
    style: box.bold === true ? "bold" : "normal",
    fill: "#111111",
  });
}

/**
 * The drawing capability handed to `draw`: the shared Painter view over the
 * run's surface. No `random`, no input state, no parameter store: the object
 * never carries what `draw` may not touch.
 */
export class TeaView extends PainterView implements View {
  #surface: Surface;
  #decl: ParamsDecl;
  #getParams: () => ParamValues<ParamsDecl>;

  constructor(deps: { surface: Surface; decl: ParamsDecl; getParams: () => ParamValues<ParamsDecl> }) {
    super(deps.surface.painter);
    this.#surface = deps.surface;
    this.#decl = deps.decl;
    this.#getParams = deps.getParams;
  }

  control(name: string, box: ControlBox): void {
    const model = controlModels({ decl: this.#decl, values: this.#getParams() }).find((m) => m.name === name);
    if (model === undefined) {
      throw new SketchUsageError({ detail: `control("${name}"): no param named "${name}" is declared` });
    }
    // Control boxes are canvas coordinates, as the browser's overlay places them.
    this.painter.inCanvasSpace(() => {
      drawStandIn(this.painter, { box, model });
      this.painter.debugBox(`control ${name}`, box.x, box.y, box.w, box.h ?? NATURAL_HEIGHT);
    });
  }

  get ctx(): SKRSContext2D {
    return this.#surface.ctx;
  }
  /** Headless renders have no pointer. */
  cursor(_kind: CursorKind): void {}
  log(...args: readonly unknown[]): void {
    this.#surface.log(...args);
  }
  snapshot(label?: string): void {
    this.#surface.snapshot(label);
  }
}

/**
 * The capability handed to `init` and `update`: seeded randomness (shared with
 * the run's single PRNG stream, so it stays deterministic and replayable),
 * `log`, and a live view of the resolved parameter values. No drawing surface —
 * `update` cannot paint.
 */
export class TeaUtil<D extends ParamsDecl> implements Util<D> {
  #surface: Surface;
  #getParams: () => ParamValues<D>;
  #onHandled: (name: string) => void;

  constructor(deps: { surface: Surface; getParams: () => ParamValues<D>; onHandled: (name: string) => void }) {
    this.#surface = deps.surface;
    this.#getParams = deps.getParams;
    this.#onHandled = deps.onHandled;
  }

  random(): number;
  random(max: number): number;
  random(min: number, max: number): number;
  random(a?: number, b?: number): number {
    const r = this.#surface.random();
    if (a === undefined) return r;
    if (b === undefined) return r * a;
    return a + r * (b - a);
  }

  randomChoice<T>(items: readonly T[]): T {
    return this.#surface.randomChoice(items);
  }

  get params(): ParamValues<D> {
    return this.#getParams();
  }

  log(...args: readonly unknown[]): void {
    this.#surface.log(...args);
  }

  record<K extends string, V>(keys: readonly K[], value: (key: K) => V): Record<K, V> {
    return recordOf(keys, value);
  }

  handled(name: string): void {
    this.#onHandled(name);
  }
}
