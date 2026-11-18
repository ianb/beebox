// What changes per frame in the file room: lamps warming up, the open drawer
// with its index cards, the card the bee holds, and the bee.
import type { Drawing, Picture, Vec2, View } from "@ianbicking/canvas-loop";
import { BRASS, CREAM, drawerFace } from "./file-room-room-tea.js";
import { type BeeState, type Lamp, type Stop, LOOP, TAU, cabTop, clamp01, hash, lampLightAt, slotOf } from "./file-room-layout-tea.js";

const WARM = "#ffcf8e";
const BEE_INK = "#2a1a0e";

/** `blend(a, b)(t)`: colour a at t = 0 toward colour b at t = 1. */
const blend =
  (a: string, b: string) =>
  (t: number): string =>
    `color-mix(in oklab, ${a}, ${b} ${Math.round(clamp01(t) * 100)}%)`;

export interface LampSpec {
  lamp: Lamp;
  /** 0 dark .. 1 fully lit. */
  level: number;
}

/** The emissive shade and bulb of one lamp. Pendants hang from a cord; banker's lamps stand on a cabinet. */
export function lampShade(v: View, spec: LampSpec): Drawing {
  const { lamp: l, level } = spec;
  if (l.kind === "pendant") {
    return [
      v.path([["move", l.x - 56, 168], ["bezier", l.x - 56, 128, l.x - 26, 112, l.x, 112], ["bezier", l.x + 26, 112, l.x + 56, 128, l.x + 56, 168], ["close"]], {
        fill: blend("#14261f", "#4fb98a")(level * 0.85),
        stroke: "#0a120f",
        weight: 2,
        material: { bevel: 4, shine: 0.5, emissive: 0.04 + 0.45 * level },
      }),
      v.rect(l.x - 7, 104, 14, 12, { fill: "#16120f", material: { bevel: 1.5 } }),
      v.rect(l.x - 58, 166, 116, 6, { fill: "#0a120f", material: { bevel: 2, shine: 0.4 } }),
      v.ellipse(l.x, 174, 22, 10, { fill: blend("#4a463c", "#fff1c4")(level), material: { emissive: 0.15 + 0.85 * level } }),
    ];
  }
  const y = cabTop(1) - 7 - 52;
  return [
    v.rect(l.x - 5, y - 4, 10, 10, { fill: BRASS, material: { bevel: 2, shine: 0.8 } }),
    v.path([["move", l.x - 48, y + 8], ["bezier", l.x - 48, y - 28, l.x - 26, y - 40, l.x, y - 40], ["bezier", l.x + 26, y - 40, l.x + 48, y - 28, l.x + 48, y + 8], ["close"]], {
      fill: blend("#0f3a2b", "#4fc08c")(level * 0.85),
      stroke: "#08201a",
      weight: 2,
      material: { bevel: 5, shine: 0.7, emissive: 0.05 + 0.6 * level },
    }),
    v.ellipse(l.x, y + 8, 48, 7, { fill: blend("#2e2c24", "#fff0c0")(level), material: { emissive: 0.1 + 0.9 * level } }),
  ];
}

/** The point light of a lit lamp (nothing while it is dark). */
export function lampLight(v: View, spec: LampSpec): Drawing {
  const { lamp: l, level } = spec;
  if (level < 0.004) return null;
  return v.light({ kind: "point", at: lampLightAt(l), height: l.kind === "pendant" ? 110 : 90, color: WARM, energy: 4.6 * level, reach: 760 });
}

/** A soft warm haze round a lit lamp, drawn over the room. */
export function lampHalo(v: View, spec: LampSpec): Drawing {
  const { lamp: l, level } = spec;
  if (level < 0.01) return null;
  const [x, y] = lampLightAt(l);
  return v.circle(x, y, 230, { fill: v.radialGradient(x, y, 230, [[0, `rgba(255,200,130,${(0.34 * level).toFixed(3)})`], [1, "rgba(255,200,130,0)"]]), blend: "screen" });
}

export interface DrawerSpec {
  stop: Stop;
  /** 0 closed .. 1 fully out. */
  open: number;
}

/** The drawer sliding out: dark opening, a row of index cards, the face moved down and forward. */
export function openDrawer(v: View, spec: DrawerSpec): Drawing {
  const { stop, open } = spec;
  if (open <= 0.001) return null;
  const s = slotOf(stop.cab, stop.row);
  const faceTop = s.y + 30 * open;
  return [
    v.rect(s.x + 2, s.y, s.w - 4, s.h, { fill: "#0c0807" }),
    v.polygon([[s.x + 10, s.y + 2], [s.x + s.w - 10, s.y + 2], [s.x + s.w + 2, faceTop + 4], [s.x - 2, faceTop + 4]], { fill: "#1d1510" }),
    Array.from({ length: 16 }, (_, i) => {
      const cx = s.x + 12 + i * ((s.w - 24) / 15);
      const h = (16 + hash(stop.cab * 7 + i + 3) * 8) * open;
      return [
        v.rect(cx - 4, faceTop + 4 - h, 8, h, { fill: i % 5 === 2 ? "#d8c68e" : CREAM, stroke: "rgba(0,0,0,0.35)", weight: 1 }),
        i % 4 === 1 && v.rect(cx - 2, faceTop + 2 - h, 4, 4, { fill: i % 8 === 1 ? "#b8574a" : "#4f7aa8" }),
      ];
    }),
    v.at({ translate: [s.x + s.w / 2, faceTop + s.h / 2], scale: [1 + 0.035 * open, 1 + 0.045 * open] }, drawerFace(v, { cab: stop.cab, row: stop.row, open })),
  ];
}

export interface CardSpec {
  at: Vec2;
  tilt: number;
}

/** An index card with a red rule and ruled lines. */
export function heldCard(v: View, spec: CardSpec): Drawing {
  return v.at({ translate: spec.at, rotate: spec.tilt }, [
    v.rect(-20, -13, 40, 26, { fill: CREAM, stroke: "rgba(60,40,20,0.6)", weight: 1.2 }),
    v.line(-15, -5, 15, -5, { stroke: "#c07a74", weight: 1.2 }),
    [0, 1, 2].map((i) => v.line(-15, 1 + i * 5, 15 - i * 4, 1 + i * 5, { stroke: "rgba(60,70,110,0.55)", weight: 1 })),
  ]);
}

// ---- the bee (faces right; flipped by a negative x scale) -----------------------

const BODY_OUTLINE: Vec2[] = Array.from({ length: 28 }, (_, i): Vec2 => [26 * Math.cos((i / 28) * TAU), 19 * Math.sin((i / 28) * TAU)]);

function beeBody(v: View): Picture {
  return v.picture({ key: "bee-body" }, () => [
    [-10, 2, 12].map((x) => v.line(x, 14, x - 3, 24, { stroke: BEE_INK, weight: 2.2 })),
    v.polygon(BODY_OUTLINE, { fill: "#f6bb2d" }),
    v.clip(BODY_OUTLINE, [
      [-16, -3, 10].map((x) => v.rect(x, -22, 8, 44, { fill: BEE_INK })),
      v.ellipse(2, 11, 22, 8, { fill: "rgba(120,60,0,0.25)" }),
      v.ellipse(0, -11, 15, 5, { fill: "rgba(255,244,180,0.55)" }),
    ]),
    v.polygon(BODY_OUTLINE, { stroke: "#3a2208", weight: 2.5 }),
    v.polygon([[-25, -3], [-36, 0], [-25, 3]], { fill: BEE_INK }),
    v.circle(28, -1, 12, { fill: BEE_INK }),
    v.circle(32, -4, 4.5, { fill: "#fff7e0" }),
    v.circle(33, -4, 2.2, { fill: "#111" }),
    v.path([["move", 31, -11], ["quad", 36, -24, 44, -26]], { stroke: BEE_INK, weight: 2 }),
    v.path([["move", 26, -12], ["quad", 28, -26, 35, -32]], { stroke: BEE_INK, weight: 2 }),
    v.circle(44, -26, 2.2, { fill: BEE_INK }),
    v.circle(35, -32, 2.2, { fill: BEE_INK }),
  ]);
}

interface WingSpec {
  angle: number;
  far: boolean;
}

function wing(v: View, spec: WingSpec): Drawing {
  const { angle, far } = spec;
  return v.at({ translate: [far ? 8 : -4, -14], rotate: angle }, [
    v.ellipse(0, -21, 12, 25, { fill: far ? "rgba(214,230,255,0.38)" : "rgba(226,238,255,0.55)", stroke: "rgba(255,255,255,0.7)", weight: 1.4 }),
  ]);
}

export interface BeeSpec {
  state: BeeState;
  frame: number;
}

/** The bee: a cached striped body, two translucent wings that flutter at 10 Hz. */
export function bee(v: View, spec: BeeSpec): Drawing {
  const { state, frame } = spec;
  const flap = 0.5 + 0.5 * Math.sin((TAU * 600 * frame) / LOOP);
  // The turn is rounded to a few squash steps so each is kept as a picture version.
  const sx = Math.round(state.turn * 5) / 5 || 0.2;
  return v.at({ translate: [state.x, state.y], scale: [sx, 1] }, [
    wing(v, { angle: -0.15 - 0.55 * flap, far: true }),
    v.place(beeBody(v), 0, 0, { tint: "oklch(0.3 0.04 260 / 0.22)" }),
    wing(v, { angle: 0.25 - 0.7 * flap, far: false }),
  ]);
}
