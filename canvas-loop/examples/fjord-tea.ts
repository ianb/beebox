// A fjord with tides — a port of gallery/fjord-tides/sketch-tea.ts to the View
// drawing primitives (polygon/path/gradient/clip/arc), with ZERO `v.ctx` use.
// The scene is identical: layered jagged cliff walls receding to a hazy
// horizon, water filling the channel between them, a `timeOfDay` palette swap,
// and a tide read perspective-correctly at the water's edges (exposed foreshore
// + widening wet-rock band) rather than as a line sliding up the screen.
//
// Model-building (seeded point arrays, built once in `init`) is unchanged from
// the original; only the draw side is rewritten to go through `View`.
import type { ColorStop, DeepReadonly, Msg, ParamsDecl, ParamValues, PathCommand, Util, Vec2, View } from "@ianbicking/canvas-loop";

export const params = {
  tide: { type: "number", min: -1, max: 1, default: 0, step: 0.05 },
  timeOfDay: { type: "select", options: ["day", "dusk"], default: "day" },
} as const satisfies ParamsDecl;

export const canvas = { width: 500, height: 400 };

type Params = ParamValues<typeof params>;

interface Point {
  x: number;
  y: number;
}

interface CliffLayer {
  topRidgeLeft: readonly Point[];
  innerEdgeLeft: readonly Point[];
  topRidgeRight: readonly Point[];
  innerEdgeRight: readonly Point[];
}

export interface Model {
  frame: number;
  far: CliffLayer;
  mid: CliffLayer;
  near: CliffLayer;
  hazeSkyline: readonly Point[];
}

const WIDTH = 500;
const HEIGHT = 400;
const HORIZON_Y = 165;
const WATER_TOP_Y = 272;
const BEACH_MAX_EXPOSED = 68;

// Each wall's ridge slopes from `outerY` (high, at the frame edge) down to
// `topY` where it meets the channel — nested Vs receding toward the horizon.
const FAR_CONFIG = { outerY: 150, topY: 176, edgeTopX: 222, edgeBottomX: 202, ridgeAmp: 10, edgeAmp: 6 };
const MID_CONFIG: LayerConfig = { outerY: 118, topY: 226, edgeTopX: 202, edgeBottomX: 168, ridgeAmp: 16, edgeAmp: 11 };
const NEAR_CONFIG: LayerConfig = { outerY: 62, topY: 272, edgeTopX: 168, edgeBottomX: 95, ridgeAmp: 24, edgeAmp: 17 };
type LayerConfig = typeof FAR_CONFIG;

// Jagged skyline sloping fromY→toY as x sweeps fromX→toX; y jitters upward
// off the slope (rocky peaks against the sky, not a smooth bump).
function jaggedRidge(
  a: { u: Util<typeof params>; fromX: number; toX: number; fromY: number; toY: number; amp: number },
): Point[] {
  const { u, fromX, toX, fromY, toY, amp } = a;
  const steps = 9;
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const base = fromY + (toY - fromY) * t;
    pts.push({ x: fromX + (toX - fromX) * t, y: base - u.random(0, amp) + u.random(0, amp * 0.25) });
  }
  return pts;
}

// Jagged rock face: y sweeps fromY..toY, x jitters off the fromX..toX line.
function jaggedEdge(
  a: { u: Util<typeof params>; fromY: number; toY: number; fromX: number; toX: number; amp: number },
): Point[] {
  const { u, fromY, toY, fromX, toX, amp } = a;
  const steps = 16;
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({ x: fromX + (toX - fromX) * t + u.random(-amp, amp), y: fromY + (toY - fromY) * t });
  }
  return pts;
}

function buildLayer(u: Util<typeof params>, cfg: LayerConfig): CliffLayer {
  const { outerY, topY, edgeTopX, edgeBottomX, ridgeAmp, edgeAmp } = cfg;
  const ridge = (x0: number, x1: number): Point[] =>
    jaggedRidge({ u, fromX: x0, toX: x1, fromY: outerY, toY: topY, amp: ridgeAmp });
  const edge = (x0: number, x1: number): Point[] =>
    jaggedEdge({ u, fromY: topY, toY: HEIGHT, fromX: x0, toX: x1, amp: edgeAmp });
  return {
    topRidgeLeft: ridge(0, edgeTopX),
    innerEdgeLeft: edge(edgeTopX, edgeBottomX),
    topRidgeRight: ridge(WIDTH, WIDTH - edgeTopX),
    innerEdgeRight: edge(WIDTH - edgeTopX, WIDTH - edgeBottomX),
  };
}

function buildHazeSkyline(u: Util<typeof params>): readonly Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= 14; i++) pts.push({ x: (i / 14) * WIDTH, y: HORIZON_Y - 18 - u.random(0, 14) });
  return pts;
}

export function init(u: Util<typeof params>): Model {
  return {
    frame: 0,
    far: buildLayer(u, FAR_CONFIG),
    mid: buildLayer(u, MID_CONFIG),
    near: buildLayer(u, NEAR_CONFIG),
    hazeSkyline: buildHazeSkyline(u),
  };
}

// eslint-disable-next-line max-params -- TEA contract signature
export function update(model: DeepReadonly<Model>, msg: Msg, _u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick":
      return { ...model, frame: msg.frame };
    case "mousedown":
    case "mouseup":
    case "mousemove":
    case "keydown":
    case "keyup":
    case "param":
    case "trigger":
      return model;
  }
}

function xAtY(edge: readonly Point[], y: number): number {
  for (let i = 0; i < edge.length - 1; i++) {
    const p0 = edge[i];
    const p1 = edge[i + 1];
    if (p0 === undefined || p1 === undefined) continue;
    if (y >= p0.y && y <= p1.y) {
      const t = (y - p0.y) / (p1.y - p0.y || 1);
      return p0.x + (p1.x - p0.x) * t;
    }
  }
  const last = edge[edge.length - 1];
  return last !== undefined && y >= last.y ? last.x : (edge[0]?.x ?? 0);
}

// Screen y of the water's front edge: tide 1 → past the bottom of the frame
// (foreshore fully submerged), tide -1 → BEACH_MAX_EXPOSED px of shore.
function beachYFor(tide: number): number {
  return HEIGHT + 2 - ((1 - tide) / 2) * (BEACH_MAX_EXPOSED + 2);
}

interface Palette {
  skyTop: string;
  skyBottom: string;
  haze: string;
  distantWater: string;
  far: string;
  mid: string;
  near: string;
  wetBand: string;
  waterNear: string;
  waterFar: string;
  ripple: string;
  beach: string;
}

const DUSK_PALETTE: Palette = {
  skyTop: "#2b2f4d",
  skyBottom: "#e8875a",
  haze: "#6b5a78",
  distantWater: "#c98f74",
  far: "#5c5470",
  mid: "#3c3550",
  near: "#221c2c",
  wetBand: "rgba(15, 8, 14, 0.55)",
  waterNear: "#b47c62",
  waterFar: "#2c1c38",
  ripple: "rgba(240, 170, 130, 0.35)",
  beach: "#514049",
};

const DAY_PALETTE: Palette = {
  skyTop: "#6fb6dd",
  skyBottom: "#cfe9f2",
  haze: "#8fa8b3",
  distantWater: "#a8ccd6",
  far: "#7f97a1",
  mid: "#54685f",
  near: "#2e3f37",
  wetBand: "rgba(12, 20, 16, 0.5)",
  waterNear: "#8fbcc8",
  waterFar: "#164253",
  ripple: "rgba(220, 245, 250, 0.4)",
  beach: "#7a7168",
};

// The two cliff walls as one path with two subpaths — usable both as a fill
// (`v.path`) and as a clip region (`v.clip`). Each wall runs corner→ridge→inner
// edge→corner, closed, mirroring the original ctx `ridgePath`.
function wallCommands(layer: CliffLayer, side: "left" | "right"): PathCommand[] {
  const topRidge = side === "left" ? layer.topRidgeLeft : layer.topRidgeRight;
  const innerEdge = side === "left" ? layer.innerEdgeLeft : layer.innerEdgeRight;
  const cornerX = side === "left" ? 0 : WIDTH;
  const cmds: PathCommand[] = [["move", cornerX, HEIGHT]];
  const firstRidge = topRidge[0];
  if (firstRidge !== undefined) cmds.push(["line", cornerX, firstRidge.y]);
  for (const p of [...topRidge, ...innerEdge]) cmds.push(["line", p.x, p.y]);
  cmds.push(["line", cornerX, HEIGHT], ["close"]);
  return cmds;
}

function layerCommands(layer: CliffLayer): PathCommand[] {
  return [...wallCommands(layer, "left"), ...wallCommands(layer, "right")];
}

// Polyline (open) as a path of move+line commands — for the ripple/wet-band strokes.
function polyline(points: readonly Point[]): PathCommand[] {
  const cmds: PathCommand[] = [];
  let started = false;
  for (const p of points) {
    cmds.push(started ? ["line", p.x, p.y] : ["move", p.x, p.y]);
    started = true;
  }
  return cmds;
}

// Fills the cliff mass, then overlays a top-lit/base-shadowed gradient clipped
// to the same silhouette — flat cutouts gain a rock face.
function fillLayer(a: { v: View; layer: CliffLayer; color: string; topY: number }): void {
  const { v, layer, color, topY } = a;
  const mass = layerCommands(layer);
  v.noStroke();
  v.fill(color);
  v.path(mass);
  const shade: readonly ColorStop[] = [
    [0, "rgba(255,255,255,0.15)"],
    [1, "rgba(0,0,0,0.32)"],
  ];
  v.clip(mass, () => {
    v.fill(v.linearGradient(0, topY, 0, HEIGHT, shade));
    v.rect(0, topY, WIDTH, HEIGHT - topY);
  });
}

function drawSky(v: View, palette: Palette): void {
  v.background(v.linearGradient(0, 0, 0, HORIZON_Y + 40, [
    [0, palette.skyTop],
    [1, palette.skyBottom],
  ]));
}

function drawHazeSkyline(a: { v: View; skyline: readonly Point[]; palette: Palette }): void {
  const { v, skyline, palette } = a;
  const outline: Vec2[] = [
    [0, HORIZON_Y + 6],
    ...skyline.map((p): Vec2 => [p.x, p.y]),
    [WIDTH, HORIZON_Y + 6],
  ];
  v.noStroke();
  v.fill(palette.haze);
  v.polygon(outline);
}

// Region between the near cliffs' inner edges from `topY` to the frame bottom —
// the water sheet and the exposed beach both clip to it.
function channelPolygon(near: CliffLayer, topY: number): Vec2[] {
  return [
    [xAtY(near.innerEdgeLeft, topY), topY],
    ...near.innerEdgeLeft.filter((p) => p.y >= topY).map((p): Vec2 => [p.x, p.y]),
    [xAtY(near.innerEdgeLeft, HEIGHT), HEIGHT],
    [xAtY(near.innerEdgeRight, HEIGHT), HEIGHT],
    ...near.innerEdgeRight.filter((p) => p.y >= topY).toReversed().map((p): Vec2 => [p.x, p.y]),
    [xAtY(near.innerEdgeRight, topY), topY],
  ];
}

function drawWater(a: { v: View; near: CliffLayer; frame: number; palette: Palette }): void {
  const { v, near, frame, palette } = a;
  v.clip(channelPolygon(near, WATER_TOP_Y), () => {
    v.noStroke();
    v.fill(v.linearGradient(0, WATER_TOP_Y, 0, HEIGHT, [
      [0, palette.waterNear],
      [1, palette.waterFar],
    ]));
    v.rect(0, WATER_TOP_Y, WIDTH, HEIGHT - WATER_TOP_Y);
    // Gentle animated ripple lines double as light glints scrolling on the water.
    v.noFill();
    v.stroke(palette.ripple);
    v.strokeWeight(1);
    for (let y0 = WATER_TOP_Y + 6; y0 < HEIGHT; y0 += 13) {
      const pts: Point[] = [];
      for (let x = 0; x <= WIDTH; x += 10) {
        pts.push({ x, y: y0 + Math.sin(x * 0.05 + frame * 0.05 + y0 * 0.1) * 2.5 });
      }
      v.path(polyline(pts));
    }
  });
}

// Wet-rock rim along the cliff bases: a wide stroke centered on each inner edge,
// clipped to the cliff side. Widens as the tide drops, near-vanishes at high tide.
function drawWetBands(a: { v: View; near: CliffLayer; tide: number; palette: Palette }): void {
  const { v, near, tide, palette } = a;
  v.clip(layerCommands(near), () => {
    v.noFill();
    v.stroke(palette.wetBand);
    v.strokeWeight(2 * (1.5 + ((1 - tide) / 2) * 9));
    for (const edge of [near.innerEdgeLeft, near.innerEdgeRight]) v.path(polyline(edge));
  });
}

// The exposed foreshore: wet strip at the waterline, drier gravel below, with a
// pale foam line at the contact.
function drawBeach(a: { v: View; near: CliffLayer; beachY: number; palette: Palette }): void {
  const { v, near, beachY, palette } = a;
  if (beachY >= HEIGHT) return;
  v.clip(channelPolygon(near, beachY), () => {
    v.noStroke();
    v.fill(palette.beach);
    v.rect(0, beachY, WIDTH, HEIGHT - beachY);
    v.fill(palette.wetBand);
    v.rect(0, beachY, WIDTH, 9);
    v.noFill();
    v.stroke("rgba(255, 255, 255, 0.45)");
    v.strokeWeight(1.5);
    v.line(0, beachY + 1, WIDTH, beachY + 1);
  });
}

// eslint-disable-next-line max-params -- TEA contract signature
export function draw(v: View, model: DeepReadonly<Model>, p: Params): void {
  const palette = p.timeOfDay === "dusk" ? DUSK_PALETTE : DAY_PALETTE;
  const beachY = beachYFor(p.tide);

  drawSky(v, palette);
  drawHazeSkyline({ v, skyline: model.hazeSkyline, palette });
  // Distant hazy water fills everything below the horizon — the channel gap
  // between the cliffs reads as fjord, not sky; layers painted next cover it.
  v.noStroke();
  v.fill(palette.distantWater);
  v.rect(0, HORIZON_Y + 5, WIDTH, HEIGHT - HORIZON_Y - 5);
  fillLayer({ v, layer: model.far, color: palette.far, topY: FAR_CONFIG.outerY });
  fillLayer({ v, layer: model.mid, color: palette.mid, topY: MID_CONFIG.outerY });
  fillLayer({ v, layer: model.near, color: palette.near, topY: NEAR_CONFIG.outerY });
  drawWater({ v, near: model.near, frame: model.frame, palette });
  drawWetBands({ v, near: model.near, tide: p.tide, palette });
  drawBeach({ v, near: model.near, beachY, palette });

  v.noStroke();
  v.fill("rgba(255,255,255,0.85)");
  v.textSize(12);
  v.textAlign("left", "top");
  const shore = Math.max(0, Math.round(HEIGHT - beachY));
  v.text(`tide ${p.tide.toFixed(2)}  ${p.timeOfDay}  shore ${shore}px  frame ${model.frame}`, 8, 8);
}
