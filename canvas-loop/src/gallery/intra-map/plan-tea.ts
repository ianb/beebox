// A floor plan of part of Intra (~/src/intra-game), as data.
//
// Rooms are rectangles on a 16 px tile grid, placed to follow intra-game's
// app/maplayout.ts (one room per layout cell, sized to its role). Doors come from
// the rooms' exits: each exit between two rooms on this plan becomes a gap in the
// wall they share. Exits to rooms off this plan become a door with a sign.
//
// Everything drawn belongs to a depth layer:
//   floor     under everything (flooring, the pool, the light from the sky screens)
//   standing  walls, props and people, sorted by `baseY`: the y where each one
//             meets the floor. Something lower on the map is nearer, so it is
//             drawn later and covers what stands behind it.
//   over      above everything that stands: door lintels, sky-screen ceilings, labels
// That ordering is the depth field: for any pixel, the layer and baseY of the
// piece that painted it.

export const T = 16;

export interface Room {
  id: string;
  name: string;
  /** The room's colour in intra-game (Tailwind 500 shades), used for its walls. */
  color: string;
  /** Tiles: x, y, width, height. */
  rect: readonly [number, number, number, number];
  floor: Floor;
  sky: Sky;
  /** Exits, by room id, as in intra-game's rooms.ts. */
  exits: readonly string[];
}

export type Floor = "terracotta" | "green-tile" | "linoleum" | "carpet-blue" | "pool-deck" | "rubber" | "cafe" | "yellow" | "grey-carpet" | "stone";
export type Sky = "sunset" | "static-blue" | "pink-sunset" | "clouds" | "clear-birds" | "still-clouds" | "night" | "overcast" | "calm-static" | "teal";

export const ROOMS: readonly Room[] = [
  { id: "Hallway", name: "Hallway", color: "#34d399", rect: [0, 5, 22, 5], floor: "linoleum", sky: "calm-static", exits: ["Hollow_Atrium", "Reflection_Chamber", "Quarters_Doug", "Quarters_Marta", "Quarters_Frida", "Quarters_June", "Quarters_Lana", "Quarters_Harold", "Quarters_Greg", "Quarters_Milton", "Quarters_Gloria", "Quarters_Lily", "Quarters_Henry", "Quarters_Yours"] },
  { id: "Archive_Lounge", name: "Archive Lounge", color: "#3b82f6", rect: [22, 2, 14, 8], floor: "carpet-blue", sky: "static-blue", exits: ["Hollow_Atrium", "Tranquil_Pool", "Archive_Console"] },
  { id: "Tranquil_Pool", name: "Tranquil Pool", color: "#ec4899", rect: [36, 2, 12, 8], floor: "pool-deck", sky: "pink-sunset", exits: ["Archive_Lounge", "Joyous_Cafe"] },
  { id: "Foyer", name: "Intake Foyer", color: "#10b981", rect: [4, 13, 8, 5], floor: "green-tile", sky: "teal", exits: ["Intake", "Hollow_Atrium"] },
  { id: "Hollow_Atrium", name: "The Hollow Atrium", color: "#f97316", rect: [12, 10, 12, 11], floor: "terracotta", sky: "sunset", exits: ["Foyer", "Archive_Lounge", "Activity_Hub", "Solitude_Cubes", "Hallway"] },
  { id: "Activity_Hub", name: "Activity Hub", color: "#06b6d4", rect: [24, 10, 12, 11], floor: "rubber", sky: "clear-birds", exits: ["Hollow_Atrium", "Joyous_Cafe"] },
  { id: "Joyous_Cafe", name: "Joyous Cafe", color: "#eab308", rect: [36, 10, 12, 11], floor: "cafe", sky: "clouds", exits: ["Tranquil_Pool", "Activity_Hub"] },
  { id: "Yellow_Room", name: "Yellow Room", color: "#ca8a04", rect: [6, 23, 6, 5], floor: "yellow", sky: "still-clouds", exits: ["Solitude_Cubes"] },
  { id: "Solitude_Cubes", name: "Solitude Cubes", color: "#6366f1", rect: [12, 21, 12, 9], floor: "grey-carpet", sky: "night", exits: ["Yellow_Room", "Ill_Fitting_Lounge", "Waiting_Room", "Hollow_Atrium"] },
  { id: "Waiting_Room", name: "Waiting Room", color: "#a8a29e", rect: [24, 21, 10, 8], floor: "stone", sky: "overcast", exits: ["Solitude_Cubes"] },
];

export const MAP_W = 48;
export const MAP_H = 30;

/** Rooms you have been in: their ceilings lift away when the ceilings are shown as fog. */
export const VISITED: readonly string[] = ["Foyer", "Hollow_Atrium", "Hallway", "Activity_Hub", "Joyous_Cafe"];

/** Where an off-plan exit leaves, and its sign. */
export const OFF_PLAN: Record<string, { side: "n" | "s" | "w"; at: number; label: string }> = {
  Intake: { side: "w", at: 0.5, label: "Intake" },
  Archive_Console: { side: "n", at: 0.5, label: "Archive Console" },
  Ill_Fitting_Lounge: { side: "s", at: 0.5, label: "Ill-Fitting Lounge" },
  Reflection_Chamber: { side: "n", at: 0.92, label: "Reflection Chamber" },
};

/** The quarters along the Hallway's north wall, west to east. */
export const QUARTERS = ["Doug", "Marta", "Frida", "June", "Lana", "Harold", "Greg", "Milton", "Gloria", "Lily", "Henry", "Yours"] as const;

export type PropKind =
  | "statue" | "bench" | "sign" | "monitor-bank" | "vending" | "sofa" | "plant" | "treadmill" | "bike" | "weights"
  | "rest-mat" | "table" | "counter" | "chair" | "cube" | "chair-row" | "magazines" | "clock" | "fountain";

export interface Prop {
  kind: PropKind;
  room: string;
  /** Tiles, from the room's top-left: the centre of the prop's footprint. */
  at: readonly [number, number];
  /** Footprint in tiles (blocks walking); none for wall decorations. */
  size?: readonly [number, number];
  variant?: number;
}

const statues: Prop[] = [];
for (const [i, x] of [1.5, 3.5, 8.5, 10.5].entries()) statues.push({ kind: "statue", room: "Hollow_Atrium", at: [x, 2.6], size: [1, 0.8], variant: i });
for (const [i, y] of [5, 7.5].entries()) {
  statues.push({ kind: "statue", room: "Hollow_Atrium", at: [0.9, y], size: [1, 0.8], variant: 4 + i });
  statues.push({ kind: "statue", room: "Hollow_Atrium", at: [11.1, y], size: [1, 0.8], variant: 6 + i });
}

const cubes: Prop[] = [];
for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) cubes.push({ kind: "cube", room: "Solitude_Cubes", at: [2 + c * 2.6, 3.6 + r * 3], size: [2, 2], variant: r * 4 + c });

export const PROPS: readonly Prop[] = [
  ...statues,
  { kind: "sign", room: "Foyer", at: [4, 1.2], variant: 0 },
  { kind: "bench", room: "Foyer", at: [3.5, 3.4], size: [3, 0.8] },
  { kind: "monitor-bank", room: "Archive_Lounge", at: [6, 1.2] },
  { kind: "vending", room: "Archive_Lounge", at: [12.6, 2.6], size: [1.4, 1] },
  { kind: "sofa", room: "Archive_Lounge", at: [5, 5.6], size: [4, 1.2] },
  { kind: "plant", room: "Tranquil_Pool", at: [1, 2.6], size: [1, 1], variant: 0 },
  { kind: "plant", room: "Tranquil_Pool", at: [11, 2.6], size: [1, 1], variant: 1 },
  { kind: "plant", room: "Tranquil_Pool", at: [1, 6.6], size: [1, 1], variant: 2 },
  { kind: "plant", room: "Tranquil_Pool", at: [11, 6.6], size: [1, 1], variant: 3 },
  { kind: "plant", room: "Tranquil_Pool", at: [6, 2.4], size: [1, 1], variant: 4 },
  { kind: "treadmill", room: "Activity_Hub", at: [2.5, 3], size: [1.4, 2.4] },
  { kind: "bike", room: "Activity_Hub", at: [5, 3], size: [1, 1.8] },
  { kind: "weights", room: "Activity_Hub", at: [9.5, 3], size: [2, 1] },
  { kind: "rest-mat", room: "Activity_Hub", at: [3, 8], variant: 0 },
  { kind: "rest-mat", room: "Activity_Hub", at: [6, 8.4], variant: 1 },
  { kind: "rest-mat", room: "Activity_Hub", at: [9, 8], variant: 2 },
  { kind: "counter", room: "Joyous_Cafe", at: [9, 2.6], size: [4, 1] },
  { kind: "table", room: "Joyous_Cafe", at: [3, 5], size: [2, 1.4] },
  { kind: "table", room: "Joyous_Cafe", at: [7.5, 6], size: [2, 1.4] },
  { kind: "table", room: "Joyous_Cafe", at: [3.2, 8.6], size: [2, 1.4] },
  { kind: "table", room: "Joyous_Cafe", at: [8.4, 9.2], size: [2, 1.4] },
  { kind: "chair", room: "Yellow_Room", at: [3, 2.9], size: [1, 1] },
  ...cubes,
  { kind: "chair-row", room: "Waiting_Room", at: [5, 3.4], size: [7, 0.9] },
  { kind: "chair-row", room: "Waiting_Room", at: [5, 5.8], size: [7, 0.9] },
  { kind: "magazines", room: "Waiting_Room", at: [8.9, 7.2], size: [1, 0.6] },
  { kind: "clock", room: "Waiting_Room", at: [2.5, 1.1], variant: 0 },
  { kind: "clock", room: "Waiting_Room", at: [5, 1.1], variant: 1 },
  { kind: "clock", room: "Waiting_Room", at: [7.5, 1.1], variant: 2 },
];

/** Citizens and where they walk: a loop of floor points in tiles (map coordinates),
 * or a single point for someone who stays put. Speed in px per frame. */
export interface Walker {
  name: string;
  shirt: string;
  route: readonly (readonly [number, number])[];
  speed: number;
  pose?: "lying" | "sitting";
}

export const WALKERS: readonly Walker[] = [
  // Along the Hallway, into the Atrium behind the statues, through the Hub to the cafe, and back.
  { name: "June", shirt: "#e11d48", speed: 0.9, route: [[6.5, 8.6], [17, 8.6], [17, 12.2], [14.2, 12.2], [14.2, 18.5], [21, 18.5], [22, 15.5], [37.5, 15.5], [41, 15.5], [41.5, 13.2], [41.5, 17.6], [37.5, 15.5], [22, 15.5], [17, 13.5]] },
  // Round the pool.
  { name: "Lily", shirt: "#7c3aed", speed: 0.6, route: [[38, 5], [46, 5], [46, 9], [38, 9]] },
  { name: "Harold", shirt: "#0ea5e9", speed: 0, pose: "lying", route: [[30, 18.4]] },
  { name: "Gloria", shirt: "#65a30d", speed: 0, pose: "sitting", route: [[9, 25.7]] },
  { name: "Doug", shirt: "#f59e0b", speed: 0, pose: "sitting", route: [[29, 24.2]] },
];
