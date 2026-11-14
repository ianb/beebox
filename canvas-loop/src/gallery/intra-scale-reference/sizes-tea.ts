// The scale standard for side-view rooms: what a pixel is worth, how depth shows,
// and how big people and things are. Every drawing sizes itself from here.
//
// The view is orthographic: a metre is PX_PER_M pixels anywhere in the room, near
// or far. Depth shows only in where a thing stands: its foot is DEPTH_PX_PER_M
// pixels lower on the screen for every metre it stands out from the back wall. So a
// person is the same height at the back wall and at the front of the room; what
// changes is how low their feet are, and what they pass in front of or behind.

/** Pixels per metre, in every direction, at every depth. */
export const PX_PER_M = 145;
/** The screen y of the back wall's foot. */
export const BACK_FOOT_Y = 560;
/** How far down the screen a foot moves for each metre out from the back wall. */
export const DEPTH_PX_PER_M = 34;

/** Metres to pixels. */
export function m(metres: number): number {
  return metres * PX_PER_M;
}
/** The screen y of a foot standing `depth` metres out from the back wall. */
export function footY(depth: number): number {
  return BACK_FOOT_Y + depth * DEPTH_PX_PER_M;
}

/** Depths of the room's planes, metres out from the back wall. */
export const PLANES = {
  /** Things against the back wall: shelves, cabinet, sets, vending machine, doors. */
  wall: 0.35,
  /** The sofa, out in the room. */
  sofa: 1.4,
  /** Where people walk across the room. */
  walk: 2.6,
  /** The nearest things, in front of everyone: pipes, crates along the bottom edge. */
  front: 3.4,
} as const;

/** Sizes in metres, for an Intra room: a 1970s bunker, worn and improvised. */
export const SIZES = {
  ceiling: { h: 3.0, note: "the sky-screen panels hang from it" },
  woman: { h: 1.65, w: 0.42, note: "head 0.23" },
  man: { h: 1.78, w: 0.46, note: "head 0.24" },
  seated: { h: 1.25, note: "top of the head, sitting on a 0.45 seat" },
  door: { w: 0.9, h: 2.1, note: "plain door" },
  arch: { w: 1.2, h: 2.4, note: "archway between rooms" },
  sofa: { w: 2.0, h: 0.85, note: "seat 0.45, arms 0.62, plus arms 0.25 each" },
  crtSmall: { w: 0.4, h: 0.35, note: "14-inch set" },
  crtMedium: { w: 0.55, h: 0.46, note: "19-inch set" },
  crtLarge: { w: 0.7, h: 0.58, note: "26-inch set" },
  cabinet: { w: 2.5, h: 0.6, note: "the sets stand on it" },
  shelves: { w: 1.2, h: 2.1, note: "shelf every 0.4" },
  archive: { w: 1.1, h: 0.85, note: "reels 0.3 across" },
  vending: { w: 0.8, h: 1.85, note: "window 0.35 x 0.7" },
  table: { w: 0.5, h: 0.45, note: "side table" },
  bulb: { h: 2.3, note: "hangs from the ceiling to here" },
  pipe: { h: 2.7, note: "0.11 across, runs along the wall" },
} as const;
