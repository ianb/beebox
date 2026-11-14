// Intra (intra-game), room by room, from the side: one shared kit (kit-tea.ts,
// props-tea.ts, sky-tea.ts), one file per room. Pick the room with the `room`
// param. Rooms wider than the view pan with their walker.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, View } from "@ianbicking/canvas-loop";
import { type RoomSpec, dim, exitGlows, paintShell } from "./kit-tea.js";
import { ROOMS, ROOM_IDS } from "./rooms-tea.js";
import { VIEW_H, VIEW_W, m } from "./sizes-tea.js";
import { paintSky } from "./sky-tea.js";

export const params = {
  room: { type: "select", options: ROOM_IDS, default: ROOM_IDS[0], label: "Room" },
} as const satisfies ParamsDecl;

export const canvas = { width: VIEW_W, height: VIEW_H };

export interface Model {
  frame: number;
}
export function init(): Model {
  return { frame: 0 };
}
export function update(model: DeepReadonly<Model>, msg: Msg): Model {
  switch (msg.type) {
    case "tick":
      return { frame: msg.frame };
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

function roomOf(id: string): RoomSpec | undefined {
  return ROOMS.find((r) => r.id === id);
}

/** Where the view sits along a room wider than it: centred, or following `focus` (px). */
function cameraX(r: RoomSpec, focus: number): number {
  const w = m(r.width);
  if (w <= VIEW_W) return (VIEW_W - w) / 2;
  return -Math.max(0, Math.min(w - VIEW_W, focus - VIEW_W / 2));
}

/** The still room, kept as a strip of sprites (a cache stays where it was first
 * drawn, so it cannot pan; sprites are placed under the camera's transform). */
const CHUNK = 1200;
function paintCached(v: View, r: RoomSpec): void {
  const x0 = -300, x1 = m(r.width) + 300;
  for (let i = 0; x0 + i * CHUNK < x1; i++) {
    const left = x0 + i * CHUNK;
    const sp = v.sprite({ key: `room-${r.id}-${i}`, width: CHUNK, height: VIEW_H }, () => {
      v.at({ translate: [-left, 0] }, () => paintShell(v, r));
    });
    v.image(sp, left, 0);
  }
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): void {
  const r = roomOf(p.room);
  if (!r) return;
  const t = model.frame;
  v.background("#0c0a0e");
  const focus = r.focus?.(t) ?? m(r.width) / 2;
  v.at({ translate: [cameraX(r, focus), 0] }, () => {
    paintCached(v, r);
    dim(v, r);
    paintSky(v, r, t);
    exitGlows(v, r, t);
    r.live?.(v, t);
  });
  v.rect(0, 0, VIEW_W, VIEW_H, { fill: v.ellipseGradient(VIEW_W / 2, VIEW_H * 0.5, VIEW_W * 0.68, VIEW_H * 0.7, [[0.65, "rgba(8,6,12,0)"], [1, "rgba(8,6,12,0.55)"]]) });
}
