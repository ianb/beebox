// The Elm-Architecture (TEA) sketch contract: the *only* module a TEA sketch
// imports. Everything here is a type — capability objects (View, Util) are
// constructed by the runtime and handed in, never imported. See TEA.md.
import type { SKRSContext2D } from "@napi-rs/canvas";

// Mirror @napi-rs/canvas's (unexported) text-align unions — see sketch.ts.
export type TextAlign = "center" | "end" | "left" | "right" | "start";
export type TextBaseline = "alphabetic" | "bottom" | "hanging" | "ideographic" | "middle" | "top";

// ── Parameter declarations ───────────────────────────────────────────
/** A number slider: `{ type: "number", min, max, default, step? }`. */
export interface NumberParam {
  type: "number";
  min: number;
  max: number;
  default: number;
  step?: number;
}
/** A boolean toggle: `{ type: "boolean", default }`. */
export interface BooleanParam {
  type: "boolean";
  default: boolean;
}
/** A choice from a fixed list: `{ type: "select", options, default }`. */
export interface SelectParam {
  type: "select";
  options: readonly string[];
  default: string;
}
/** A fire-and-forget button — no value, arrives only as a `trigger` Msg. */
export interface TriggerParam {
  type: "trigger";
}
export type ParamDecl = NumberParam | BooleanParam | SelectParam | TriggerParam;

/** A sketch's `params` export: a record of named parameter declarations. */
export type ParamsDecl = Record<string, ParamDecl>;

// Value type for a single declaration: number→number, boolean→boolean,
// select→the union of its options (literal when declared `as const`), and
// triggers carry no value (filtered out of ParamValues below).
type ParamValue<P extends ParamDecl> = P extends NumberParam
  ? number
  : P extends BooleanParam
    ? boolean
    : P extends SelectParam
      ? P["options"][number]
      : never;

/**
 * The resolved parameter values a sketch reads: `u.params` in `update` and the
 * `p` argument to `draw`. Triggers are omitted (they have no value); a select
 * declared `as const` narrows to the union of its options.
 */
export type ParamValues<D extends ParamsDecl> = {
  [K in keyof D as D[K] extends TriggerParam ? never : K]: ParamValue<D[K]>;
};

// ── Deep readonly ────────────────────────────────────────────────────
/** Recursively `readonly` — the Model type `update`/`draw` see, so mutation is a compile error. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer E)[]
    ? ReadonlyArray<DeepReadonly<E>>
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

// ── Messages ─────────────────────────────────────────────────────────
/**
 * The runtime-defined discriminated union folded through `update`. Time is a
 * message (`tick`); scripted input, parameter edits, and triggers are the rest.
 * Switch exhaustively on `msg.type`.
 */
export type Msg =
  | { type: "tick"; frame: number }
  | { type: "mousedown"; x: number; y: number }
  | { type: "mouseup"; x: number; y: number }
  | { type: "mousemove"; x: number; y: number }
  | { type: "keydown"; key: string }
  | { type: "keyup"; key: string }
  | { type: "param"; name: string; value: number | boolean | string }
  | { type: "trigger"; name: string };

// ── Injected capabilities ────────────────────────────────────────────
/**
 * The capability object handed to `init` and `update`: seeded randomness, the
 * resolved parameter values, and `log`. No drawing — `update` cannot paint.
 */
export interface Util<D extends ParamsDecl = ParamsDecl> {
  /** Seeded random in [0, 1) — or scaled to [0, max) / [min, max). */
  random(): number;
  random(max: number): number;
  random(min: number, max: number): number;
  /** Seeded uniform pick from a non-empty array. */
  randomChoice<T>(items: readonly T[]): T;
  /** Current resolved parameter values. */
  readonly params: ParamValues<D>;
  /** Frame-tagged log line into the transcript. */
  log(...args: readonly unknown[]): void;
}

/**
 * The drawing surface handed to `draw`: the p5-like subset plus `log`,
 * `snapshot`, and the raw `ctx` escape hatch. No randomness and no parameter
 * store beyond the `p` argument — `draw` cannot change the world, only render it.
 */
export interface View {
  readonly width: number;
  readonly height: number;
  background(color: string): void;
  fill(color: string): void;
  noFill(): void;
  stroke(color: string): void;
  noStroke(): void;
  strokeWeight(weight: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  circle(x: number, y: number, diameter: number): void;
  ellipse(x: number, y: number, w: number, h: number): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void;
  text(content: string, x: number, y: number): void;
  textSize(size: number): void;
  textAlign(horizontal: TextAlign, vertical?: TextBaseline): void;
  push(): void;
  pop(): void;
  translate(x: number, y: number): void;
  rotate(radians: number): void;
  scale(x: number, y?: number): void;
  log(...args: readonly unknown[]): void;
  snapshot(label?: string): void;
  readonly ctx: SKRSContext2D;
}

/** Optional `canvas` export: the drawing surface size (default 400×300). */
export interface CanvasSize {
  width: number;
  height: number;
}

/**
 * The shape of a TEA sketch module. Sketches don't have to name this type —
 * exporting `init`, `update`, `draw` (and optionally `params`/`canvas`) is
 * enough — but `satisfies TeaModule<typeof params, Model>` type-checks the whole
 * contract.
 */
export interface TeaModule<D extends ParamsDecl, M> {
  params?: D;
  canvas?: CanvasSize;
  init(u: Util<D>): M;
  update(model: DeepReadonly<M>, msg: Msg, u: Util<D>): M;
  draw(v: View, model: DeepReadonly<M>, p: ParamValues<D>): void;
}
