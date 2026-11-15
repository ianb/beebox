// The dev-loop checklist (beebox/docs/plans/canvas-loop-scene/stage4/dev-loop.md)
// as runnable sketches: each makes one mistake an agent really makes, and names
// the channel its message should come out on and what the text must name.
// `run-case.ts` runs them through the headless runner; gpu.test.ts asserts.
// A row with `gap` is not met yet: its proposal needs a decision, and its test
// is marked todo.
import type { Msg, ParamValues, ParamsDecl, Picture, View } from "../../../src/scene-draft/scene-api.js";

/** Where the message comes out: a thrown error (and its transcript line), a transcript warning, or nothing. */
export type Channel = "error" | "warning" | "none";

export interface Model {
  readonly t: number;
  readonly color: string;
}

export interface DevLoopCase {
  /** The checklist row's id. */
  readonly id: string;
  readonly mistake: string;
  readonly channel: Channel;
  /** What the message must name, each as a pattern over the error message or the warning lines (with the sketch line). */
  readonly names: readonly RegExp[];
  /** Not met yet: the proposal, for a decision. */
  readonly gap?: string;
  readonly frames?: number;
  readonly canvas?: { readonly width: number; readonly height: number };
  readonly params?: ParamsDecl;
  readonly update?: (model: Model, msg: Msg) => Model;
  readonly draw: (...args: [View, Model, ParamValues<ParamsDecl>]) => void;
}

const CASE_FILE = /cases\.ts:\d+/;
const fill = { fill: "#2a9d8f" };
// Some mistakes cannot be typed: a sketch reaching the View through `unknown` (as a JS sketch would).
const loose = (x: unknown): never => {
  // eslint-disable-next-line no-restricted-syntax -- the checklist feeds values the types forbid, as an untyped sketch would
  return x as never;
};
let kept: View | undefined;
let keptPicture: Picture | undefined;

export const CASES: readonly DevLoopCase[] = [
  {
    id: "stale-picture",
    mistake: "a picture body reads model state that is not in its deps",
    channel: "warning",
    names: [/picture "swatch"/, /deps/, /rect #1/, CASE_FILE],
    frames: 3,
    update: (m, msg) => (msg.type === "tick" ? { ...m, color: msg.frame >= 1 ? "#e63946" : m.color } : m),
    draw: (v, m) => v.place(v.picture({ key: "swatch", width: 20, height: 20 }, () => v.rect(0, 0, 20, 20, { fill: m.color })), 10, 10),
  },
  {
    id: "shared-key",
    mistake: "two different drawings under one picture key with equal deps",
    channel: "warning",
    names: [/picture "icon"/, /two drawings share the key/, CASE_FILE],
    draw: (v) => {
      v.place(v.picture({ key: "icon", width: 20, height: 20 }, () => v.rect(0, 0, 20, 20, fill)), 10, 10);
      v.place(v.picture({ key: "icon", width: 20, height: 20 }, () => v.circle(10, 10, 10, fill)), 40, 10);
    },
  },
  {
    id: "deps-every-frame",
    mistake: "a picture whose deps (or size) change every frame, so it records every frame",
    channel: "warning",
    names: [/picture "bar"/, /every frame/, CASE_FILE],
    frames: 5,
    draw: (v, m) => v.place(v.picture({ key: "bar", width: 20 + m.t, height: 10, deps: [m.t] }, () => v.rect(0, 0, 20 + m.t, 10, fill)), 10, 10),
  },
  {
    id: "nan-coordinate",
    mistake: "a NaN coordinate (an undefined value in arithmetic)",
    channel: "error",
    names: [/rect/, /\by\b/, /NaN/],
    draw: (v, m) => v.rect(10, Number(Reflect.get(m, "missing")) * 2, 20, 20, fill),
  },
  {
    id: "infinite-radius",
    mistake: "an Infinity size (a division by zero)",
    channel: "error",
    names: [/circle/, /radius/, /Infinity/],
    draw: (v, m) => v.circle(50, 50, 10 / (m.t - m.t), fill),
  },
  {
    id: "nan-point",
    mistake: "a NaN in a point list",
    channel: "error",
    names: [/curve/, /points\[1]/, /NaN/],
    draw: (v) => v.curve([[0, 0], [Number.NaN, 4], [9, 9]], false, { stroke: "#000", weight: 2 }),
  },
  {
    id: "nan-transform",
    mistake: "a NaN in an at() transform",
    channel: "error",
    names: [/at/, /rotate/, /NaN/],
    draw: (v) => v.at({ rotate: Number.NaN }, () => v.rect(0, 0, 10, 10, fill)),
  },
  {
    id: "negative-radius",
    mistake: "a negative radius",
    channel: "error",
    names: [/circle/, /radius/, /-5/],
    draw: (v) => v.circle(20, 20, -5, fill),
  },
  {
    id: "zero-size",
    mistake: "a zero-width rectangle (draws nothing, as Canvas2D)",
    channel: "none",
    names: [],
    draw: (v) => v.rect(10, 10, 0, 20, fill),
  },
  {
    id: "unknown-brush",
    mistake: "an unknown brush name",
    channel: "error",
    names: [/brush/, /"pen"/, /ink/],
    draw: (v) => v.line(0, 0, 50, 50, { stroke: "#000", weight: 3, brush: loose("pen") }),
  },
  {
    id: "unknown-blend",
    mistake: "an unknown blend name",
    channel: "error",
    names: [/blend/, /"lighter-ish"/, /multiply/],
    draw: (v) => v.rect(0, 0, 10, 10, { fill: "#000", blend: loose("lighter-ish") }),
  },
  {
    id: "unknown-effect",
    mistake: "an unknown effect name",
    channel: "error",
    names: [/effect/, /"blurr"/, /blur/],
    draw: (v) => v.group({ effects: loose({ blurr: 2 }) }, () => v.rect(0, 0, 10, 10, fill)),
  },
  {
    id: "unknown-style-key",
    mistake: "a misspelt style key",
    channel: "error",
    names: [/rect/, /"colour"/, /fill/],
    draw: (v) => v.rect(0, 0, 10, 10, loose({ colour: "#000" })),
  },
  {
    id: "bad-colour",
    mistake: "a colour string that does not parse",
    channel: "error",
    names: [/rect/, /fill/, /"#ggg"/, CASE_FILE],
    draw: (v) => v.rect(0, 0, 10, 10, { fill: "#ggg" }),
  },
  {
    id: "bad-effect-colour",
    mistake: "a glow colour that does not parse",
    channel: "error",
    names: [/glow/, /"warm yellow"/, CASE_FILE],
    draw: (v) => v.group({ effects: { glow: { blur: 4, color: "warm yellow" } } }, () => v.rect(0, 0, 10, 10, fill)),
  },
  {
    id: "view-after-draw",
    mistake: "keeping the View and drawing with it after draw returned (in update)",
    channel: "error",
    names: [/v\.rect/, /outside draw/],
    frames: 2,
    update: (m, msg) => {
      if (msg.type === "tick" && msg.frame === 1) kept?.rect(0, 0, 10, 10, fill);
      return m;
    },
    draw: (v) => {
      kept = v;
      v.rect(0, 0, 5, 5, fill);
    },
  },
  {
    id: "old-picture",
    mistake: "placing a Picture kept from an earlier frame",
    channel: "error",
    names: [/place/, /picture "dot"/, /earlier frame/, /v\.picture/],
    frames: 2,
    draw: (v) => {
      keptPicture ??= v.picture({ key: "dot", width: 10, height: 10 }, () => v.circle(5, 5, 5, fill));
      v.place(keptPicture, 10, 10);
    },
  },
  {
    id: "throw-in-group",
    mistake: "a group body that throws",
    channel: "error",
    names: [/frame 0/, /draw/, /boom in group/, CASE_FILE],
    frames: 2,
    draw: (v, m) => v.group({}, () => {
      if (m.t === 1) throw new RangeError("boom in group");
      v.rect(0, 0, 10, 10, fill);
    }),
  },
  {
    id: "throw-in-update",
    mistake: "update throws",
    channel: "error",
    names: [/frame 2/, /update/, /boom in update/, CASE_FILE],
    frames: 4,
    update: (m, msg) => {
      if (msg.type === "tick" && msg.frame === 2) throw new TypeError("boom in update");
      return msg.type === "tick" ? { ...m, t: m.t + 1 } : m;
    },
    draw: (v) => v.rect(0, 0, 10, 10, fill),
  },
  {
    id: "async-draw",
    mistake: "an async draw (returns a Promise)",
    channel: "error",
    names: [/draw/, /Promise/, /synchronous/],
    draw: loose(async (v: View): Promise<void> => {
      await Promise.resolve();
      v.rect(0, 0, 10, 10, fill);
    }),
  },
  {
    id: "mutate-model",
    mistake: "draw changes the model",
    channel: "error",
    names: [/draw/, /read only property 't'/, /model is frozen/, CASE_FILE],
    draw: (v, m) => {
      const writable: { t: number } = loose(m);
      writable.t = 99;
      v.rect(0, 0, 10, 10, fill);
    },
  },
  {
    id: "undeclared-param",
    mistake: "reading a param that is not declared",
    channel: "error",
    names: [/params\.speed/, /declared: size/, CASE_FILE],
    params: { size: { type: "number", min: 1, max: 10, default: 4 } },
    draw: (...[v, , p]) => v.circle(20, 20, 4 * Number(p["speed"] ?? 1), fill),
  },
  {
    id: "undeclared-control",
    mistake: "a control for a param that is not declared",
    channel: "error",
    names: [/control\("speed"\)/, /no param named "speed"/],
    draw: (v) => v.control("speed", { x: 0, y: 0, w: 100 }),
  },
  {
    id: "log-in-picture",
    mistake: "v.log inside a picture body",
    channel: "error",
    names: [/v\.log/, /picture "p"/, /cache/, CASE_FILE],
    draw: (v) => v.place(v.picture({ key: "p", width: 10, height: 10 }, () => v.log("hi")), 0, 0),
  },
  {
    id: "function-dep",
    mistake: "a function in a picture's deps",
    channel: "error",
    names: [/picture "p"/, /deps\[0]/, /function/],
    draw: (v) => v.place(v.picture({ key: "p", width: 10, height: 10, deps: [() => 1] }, () => v.rect(0, 0, 1, 1, fill)), 0, 0),
  },
  {
    id: "smudge-with-effects",
    mistake: "a smudge brush with effects",
    channel: "error",
    names: [/line/, /smudge/, /effects/, /group/],
    draw: (v) => v.line(0, 0, 40, 40, { stroke: "#000", weight: 8, brush: "smudge", effects: { blur: 2 } }),
  },
  {
    id: "light-unlit",
    mistake: "a light outside any lit group",
    channel: "warning",
    names: [/light point/, /outside any lit group/, CASE_FILE],
    draw: (v) => v.light({ kind: "point", at: [20, 20] }),
  },
  {
    id: "lit-no-light",
    mistake: "a lit group with no light in it",
    channel: "warning",
    names: [/lit group/, /no light/, /ambient/, CASE_FILE],
    draw: (v) => v.group({ lighting: {} }, () => v.rect(0, 0, 40, 40, fill)),
  },
  {
    id: "material-unlit",
    mistake: "a material outside a lit group (ignored silently by design, R8)",
    channel: "none",
    names: [],
    draw: (v) => v.rect(0, 0, 40, 40, { ...fill, material: { shine: 0.5 } }),
  },
  {
    id: "unknown-font",
    mistake: "text in a font that is not loaded",
    channel: "warning",
    names: [/font/, /"Comic Neuee"/, CASE_FILE],
    draw: (v) => v.text("hello", { x: 10, y: 20 }, { font: "Comic Neuee", size: 14 }),
  },
  {
    id: "transparent-pixels",
    mistake: "a pixels fill that writes colour but leaves alpha 0",
    channel: "warning",
    names: [/pixels "field"/, /transparent/, CASE_FILE],
    draw: (v) => v.place(v.pixels({ key: "field", width: 4, height: 4 }, ({ data }) => {
      for (let i = 0; i < data.length; i += 4) data[i] = 255;
    }), 0, 0),
  },
  {
    id: "pixels-replaced",
    mistake: "a pixels fill that replaces image.data instead of writing into it",
    channel: "error",
    names: [/pixels "field"/, /data/, /write into/],
    draw: (v) => v.place(v.pixels({ key: "field", width: 4, height: 4 }, (image) => {
      Reflect.set(image, "data", new Uint8ClampedArray(8).fill(255));
    }), 0, 0),
  },
  {
    id: "huge-canvas",
    mistake: "a canvas wider than the GPU's largest texture (9000 px)",
    channel: "error",
    names: [/render/, /canvas/, /9000/, /8192/],
    canvas: { width: 9000, height: 20 },
    draw: (v) => v.rect(0, 0, 9000, 20, fill),
  },
  {
    id: "huge-picture",
    mistake: "a very large plain picture (40000×40000), mostly off the canvas",
    channel: "none",
    names: [],
    draw: (v) => v.place(v.picture({ key: "sky", width: 40_000, height: 40_000 }, () => v.rect(0, 0, 40_000, 40_000, fill)), -100, -100),
  },
  {
    id: "zero-size-picture",
    mistake: "a picture with a zero width (a size from a measurement that came back 0)",
    channel: "error",
    names: [/picture "label"/, /width/, /> 0/, /got 0/, CASE_FILE],
    draw: (v) => v.place(v.picture({ key: "label", width: 0, height: 10 }, () => v.rect(0, 0, 1, 1, fill)), 0, 0),
  },
  {
    id: "same-key-sizes",
    mistake: "one picture key asked for at two sizes in a frame (two versions, by design)",
    channel: "none",
    names: [],
    draw: (v) => {
      for (const w of [10, 20]) v.place(v.picture({ key: "tile", width: w, height: 10 }, () => v.rect(0, 0, w, 10, fill)), w, 0);
    },
  },
  {
    id: "empty-clip",
    mistake: "a clip with no area (collinear points)",
    channel: "warning",
    names: [/clip/, /no area/, CASE_FILE],
    gap: "warn when a clip has no area on every frame of a run (an animated wipe starts at zero width, so one frame is not a mistake)",
    draw: (v) => v.clip([[0, 0], [20, 0], [40, 0]], () => v.rect(0, 0, 40, 40, fill)),
  },
  {
    id: "offscreen",
    mistake: "drawing entirely off the canvas (a translate in the wrong units)",
    channel: "warning",
    names: [/off the canvas/],
    gap: "after the run, warn about captured frames where nothing drawn lands on the canvas, from the bounds the renderer already culls by",
    draw: (v) => v.at({ translate: [1000, 1000] }, () => v.rect(0, 0, 40, 40, fill)),
  },
  {
    id: "point-light-no-at",
    mistake: "a point light without a position",
    channel: "error",
    names: [/light \(point\)/, /at: \[x, y]/, CASE_FILE],
    draw: (v) => v.group({ lighting: {} }, () => v.light(loose({ kind: "point" }))),
  },
  {
    id: "hatching-no-amount",
    mistake: "hatching without its required amount",
    channel: "error",
    names: [/effects\.hatching\.amount/, /0\.\.1/, /undefined/, CASE_FILE],
    draw: (v) => v.group({ effects: { hatching: loose({ spacing: 6 }) } }, () => v.rect(0, 0, 40, 40, fill)),
  },
  {
    id: "flat-hatching",
    mistake: "hatching over a group with one flat tone (nothing to hatch)",
    channel: "warning",
    names: [/hatching/, /tone/],
    gap: "the draft's 'no tone variation' warning: read back the histogram pass the renderer already runs and warn when its range is empty",
    draw: (v) => v.group({ effects: { hatching: { amount: 0.8 } } }, () => v.rect(0, 0, 80, 60, fill)),
  },
  {
    id: "faint-mark",
    mistake: "a brushed mark too faint to see",
    channel: "warning",
    names: [/faint/],
    gap: "port today's faint-mark check (core/painter/faint.ts): it needs the mark's peak alpha, which the spike computes on the GPU; read back a per-mark maximum in testing mode",
    draw: (v) => v.line(5, 5, 70, 50, { stroke: "rgba(0,0,0,0.03)", weight: 3, brush: "pencil" }),
  },
  {
    id: "missing-glyph",
    mistake: "text with a character the font has no glyph for",
    channel: "warning",
    names: [/glyph/, /U\+E000/],
    gap: "port today's missing-glyph check (core/painter/text-watch.ts) to the glyph atlas, which already rasterises each glyph on the CPU",
    draw: (v) => v.text("a\uE000b", { x: 10, y: 20 }, { size: 14 }),
  },
  {
    id: "skewed-effects",
    mistake: "a blur under a skew (the spike does not support it)",
    channel: "error",
    names: [/skew/, /group/, /not supported/],
    draw: (v) => v.at({ skew: [0.4, 0] }, () => v.group({ effects: { blur: 3 } }, () => v.rect(10, 10, 20, 20, fill))),
  },
  {
    id: "deep-nesting",
    mistake: "groups with effects nested 30 deep (pass-count blowup)",
    channel: "warning",
    names: [/passes/, /cost/],
    gap: "the transcript prints passes per captured frame but flags nothing; warn above a per-frame pass budget (a number to choose, for example 64) and name the deepest group path",
    draw: (v) => {
      const nest = (n: number): void => {
        if (n === 0) v.rect(10, 10, 20, 20, fill);
        else v.group({ effects: { blur: 1 } }, () => nest(n - 1));
      };
      nest(30);
    },
  },
  {
    id: "opacity-out-of-range",
    mistake: "a group opacity above 1 (a percentage)",
    channel: "error",
    names: [/opacity/, /0\.\.1/, /50/],
    draw: (v) => v.group({ opacity: 50 }, () => v.rect(0, 0, 10, 10, fill)),
  },
];
