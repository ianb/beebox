// Intra (intra-game), room by room, from the side: one shared kit (kit-tea.ts,
// props-tea.ts, sky-tea.ts), one file per room. Pick the room with the `room`
// param. Rooms wider than the view pan with their walker.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, SceneView as View } from "@ianbicking/canvas-loop";
import { type RoomSpec, dim, exitGlows, paintShell } from "./kit-tea.js";
import { ROOMS, ROOM_IDS } from "./rooms-tea.js";
import { VIEW_H, VIEW_W, m } from "./sizes-tea.js";
import { paintSky } from "./sky-tea.js";

export const params = {
  room: { type: "select", options: ROOM_IDS, default: ROOM_IDS[0], label: "Room" },
  // Port: a second look, the room under a watercolour wash (draft effects.wash).
  look: { type: "select", options: ["plain", "wash"], default: "plain", label: "Look" },
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

/** The still room, kept as one picture. Port: today's strip of 1200 px sprites
 * becomes one picture as wide as the room plus its margins. A picture keeps
 * what it draws outside its box (draft decision 3), so a strip of chunks would
 * each draw the whole room; nothing needs chunking once placement replays. */
function paintCached(v: View, r: RoomSpec): void {
  const x0 = -300, x1 = m(r.width) + 300;
  const pic = v.picture({ key: `room-${r.id}`, width: x1 - x0, height: VIEW_H }, () => {
    v.at({ translate: [-x0, 0] }, () => paintShell(v, r));
  });
  v.place(pic, x0, 0);
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): void {
  const r = roomOf(p.room);
  if (!r) return;
  const t = model.frame;
  v.background("#0c0a0e");
  const focus = r.focus?.(t) ?? m(r.width) / 2;
  const room = (): void => {
    paintCached(v, r);
    dim(v, r);
    paintSky(v, r, t);
    exitGlows(v, r, t);
    r.live?.(v, t);
  };
  // Port: the wash look puts the room in a washed group inside the camera, so
  // the pigment moves with the world (draft section 4).
  v.at({ translate: [cameraX(r, focus), 0] }, () => {
    if (p.look === "wash") v.group({ effects: { wash: { granulate: 0.5, edges: 0.6, blotch: 0.4 } } }, room);
    else room();
  });
  v.rect(0, 0, VIEW_W, VIEW_H, { fill: v.ellipseGradient(VIEW_W / 2, VIEW_H * 0.5, VIEW_W * 0.68, VIEW_H * 0.7, [[0.65, "rgba(8,6,12,0)"], [1, "rgba(8,6,12,0.55)"]]) });
}
