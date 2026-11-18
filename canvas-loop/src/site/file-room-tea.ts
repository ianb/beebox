// A file room at night, mostly dark. Four cabinets stand apart, two on the left
// and two on the right, each with its own lamp. A small bee in a green
// eyeshade and sleeve garters, a clerk, walks between them on two legs, takes
// an index card from one drawer, carries it across the dark middle and files
// it in another. The lamp of a cabinet warms up as they arrive and fades after
// they leave, so pools of light appear in the dark and go out again.
//
// Everything is drawn like an illustration made by hand: ink and pencil
// strokes with wobble, bristle paint, hatched shadow, paper grain. The still
// parts are cached pictures; per frame only the open drawer, the clerk, the
// card and the lamp levels change. Every motion is a pure function of the
// frame inside one loop (60 s at 60 fps): the room is dark and empty at frame 0
// and again at the end.
//
// Lighting: the room is drawn once at full brightness; a lit group of plain
// white, blended with `multiply`, then darkens it everywhere except where a
// lamp's point light reaches. (Lighting the cached pictures directly would
// replay all their shapes every frame.)
import type { DeepReadonly, Msg, RootDrawing, Vec2, View } from "@ianbicking/canvas-loop";
import { type LampSpec, lampHalo, lampLight, lampShade } from "./file-room-lamps-tea.js";
import { cardPlace, clerk } from "./file-room-clerk-tea.js";
import { drawerHand, openDrawer } from "./file-room-drawer-tea.js";
import { CABS, LOOP, beeAt, lampLevel, openAmount, stopAt } from "./file-room-layout-tea.js";
import { cabinetPicture, floorPicture } from "./file-room-room-tea.js";
import { cardPicture } from "./file-room-clerk-tea.js";
import { FLOOR } from "./file-room-layout-tea.js";

export const canvas = { width: 1600, height: 900 };

export interface Model {
  /** Frame within the loop, 0 .. LOOP - 1. */
  frame: number;
}

export function init(): Model {
  return { frame: 0 };
}

export function update(model: DeepReadonly<Model>, msg: Msg): Model {
  return msg.type === "tick" ? { frame: msg.frame % LOOP } : model;
}

export function draw(v: View, model: DeepReadonly<Model>): RootDrawing {
  const { frame } = model;
  const state = beeAt(frame);
  const lamps: LampSpec[] = CABS.map((_, cab) => ({ cab, level: lampLevel(cab, frame) }));
  const stop = stopAt(state.stop);
  const atStop = state.stop >= 0;
  const hand: Vec2 = drawerHand(stop);
  const card = cardPlace(state, hand);

  return [
    v.background("#02030a"),
    v.group({ effects: { brightness: 2, paper: 0.3 } }, [
      v.place(floorPicture(v), 0, 0),
      CABS.map((c, i) => v.place(cabinetPicture(v, i), c.x, FLOOR)),
      atStop && openDrawer(v, { stop, open: openAmount(state.d) }),
      clerk(v, { state, frame }),
      card !== null && v.place(cardPicture(v), card[0], card[1]),
    ]),
    v.group({ blend: "multiply", lighting: { ambient: "#02030a", shadows: "none", exposure: 0, toneCurve: 0.5 } }, [
      v.rect(0, 0, 1600, 900, { fill: "#ffffff" }),
      v.light({ kind: "point", at: [800, 900], height: 200, color: "#6f86c8", energy: 0.05, reach: 900 }),
      lamps.map((spec) => lampLight(v, spec)),
    ]),
    lamps.map((spec) => lampShade(v, spec)),
    lamps.map((spec) => lampHalo(v, spec)),
  ];
}
