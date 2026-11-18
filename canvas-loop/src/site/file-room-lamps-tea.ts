// The lamps: a banker's lamp with a green glass shade and an enamel pendant on
// a cord. Their ink outlines are cached pictures. Each frame draws only the
// flat colours that change with the lamp's level: the bulb first, then the
// shade over it, so only the part of the bulb below the rim shows.
import type { Drawing, Picture, Vec2, View } from "@ianbicking/canvas-loop";
import { INK, penLine } from "./file-room-ink-tea.js";
import { K, cabAt, clamp01, lampLightAt, lampRim } from "./file-room-layout-tea.js";

const WARM = "#ffcf8e";

/** `blend(a, b)(t)`: colour a at t = 0 toward colour b at t = 1. */
const blend =
  (a: string, b: string) =>
  (t: number): string =>
    `color-mix(in oklab, ${a}, ${b} ${Math.round(clamp01(t) * 100)}%)`;

const DOME = (w: number, h: number): Vec2[] => [[-w, 0], [-w * 0.95, -h * 0.55], [-w * 0.55, -h * 0.92], [0, -h], [w * 0.55, -h * 0.92], [w * 0.95, -h * 0.55], [w, 0]];
const PENDANT = { w: 54, h: 54 };
const BANKER = { w: 50, h: 38 };

function shadeOutline(v: View, kind: "pendant" | "banker"): Picture {
  const { w, h } = kind === "pendant" ? PENDANT : BANKER;
  return v.picture({ key: `shade-${kind}`, paper: { scale: 3, contrast: 0.6, seed: 5 } }, () => [
    v.curve(DOME(w, h), false, { stroke: INK, weight: 3, brush: { preset: "ink", thinning: 0.35 }, gesture: { wobble: 0.8, seed: kind === "pendant" ? 3 : 4 } }),
    penLine(v, { a: [-w - 3, 0], b: [w + 3, 0], seed: kind === "pendant" ? 11 : 12, weight: 3.6 }),
    kind === "pendant" && [penLine(v, { a: [-6, -h - 8], b: [6, -h - 8], seed: 13, weight: 4 }), penLine(v, { a: [0, -h - 8], b: [0, -h - 170], seed: 15, weight: 2.6 }), penLine(v, { a: [-10, -h - 170], b: [10, -h - 170], seed: 16, weight: 3.4 })],
    kind === "banker" && penLine(v, { a: [-w * 0.6, -h * 0.55], b: [-w * 0.2, -h * 0.9], seed: 14, weight: 1.6, color: "rgba(255,255,255,0.4)" }),
  ]);
}

export interface LampSpec {
  cab: number;
  /** 0 dark .. 1 fully lit. */
  level: number;
}

/** One lamp: bulb behind, the shade's colour over it, then the shade's ink outline. */
export function lampShade(v: View, spec: LampSpec): Drawing {
  const { cab, level } = spec;
  const kind = cabAt(cab).lamp;
  const rim = lampRim(cab);
  const { w, h } = kind === "pendant" ? PENDANT : BANKER;
  const dome = v.curve(DOME(w, h), true, { fill: blend(kind === "pendant" ? "#0d1815" : "#0b1a14", kind === "pendant" ? "#4fb98a" : "#4fc08c")(level * 0.85) });
  return v.at({ translate: [rim.x, rim.y], scale: K }, [
    v.circle(0, 7, 11, { fill: blend("#2a2822", "#fff1c4")(level) }),
    dome,
    v.rect(-w, -2, 2 * w, 4, { fill: blend("#080c0b", "#9ee0b8")(level * 0.6) }),
    v.place(shadeOutline(v, kind), 0, 0),
    // the lit underside of the shade, just below the rim
    level > 0.01 && v.ellipse(0, 5, w * 0.8, 5, { fill: `rgba(255,236,170,${(0.9 * level).toFixed(2)})` }),
  ]);
}

/** The point light of a lit lamp (nothing while it is dark). */
export function lampLight(v: View, spec: LampSpec): Drawing {
  if (spec.level < 0.004) return null;
  return v.light({ kind: "point", at: [...lampLightAt(spec.cab)], height: 80, color: WARM, energy: 5.2 * spec.level, reach: 340 });
}

/** A soft warm haze round a lit lamp, drawn over the room. */
export function lampHalo(v: View, spec: LampSpec): Drawing {
  if (spec.level < 0.01) return null;
  const [x, y] = lampLightAt(spec.cab);
  return v.circle(x, y, 200, { fill: v.radialGradient(x, y, 200, [[0, `rgba(255,200,130,${(0.32 * spec.level).toFixed(3)})`], [1, "rgba(255,200,130,0)"]]), blend: "screen" });
}
