// A small easter egg: a moth circles a lit lamp.
import type { Drawing, View } from "@ianbicking/canvas-loop";
import { TAU, lampLightAt, smooth } from "./file-room-layout-tea.js";
import { LOOP } from "./file-room-path-tea.js";

export interface MothSpec {
  cab: number;
  level: number;
  frame: number;
}

/** The moth: a body and two flapping wings on a looping path round the lamp's light. */
export function moth(v: View, spec: MothSpec): Drawing {
  const alpha = smooth(spec.level * 1.6 - 0.5);
  if (alpha <= 0.01) return null;
  const [cx, cy] = lampLightAt(spec.cab);
  const a = (TAU * 50 * spec.frame) / LOOP;
  const x = cx + 44 * Math.cos(a) + 8 * Math.sin(3 * a);
  const y = cy - 6 + 26 * Math.sin(a) + 6 * Math.cos(4 * a);
  const flap = 0.35 + 0.65 * Math.abs(Math.sin((TAU * 300 * spec.frame) / LOOP));
  const wing = `rgba(238,228,204,${(0.95 * alpha).toFixed(2)})`;
  return [
    v.ellipse(x - 7, y - 4, 10, 8 * flap, { fill: wing, stroke: `rgba(90,76,58,${alpha.toFixed(2)})`, weight: 1 }),
    v.ellipse(x + 7, y - 4, 10, 8 * flap, { fill: wing, stroke: `rgba(90,76,58,${alpha.toFixed(2)})`, weight: 1 }),
    v.ellipse(x, y, 3.2, 8, { fill: `rgba(96,76,54,${alpha.toFixed(2)})` }),
  ];
}
