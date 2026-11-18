// A file room at night. A small bee flies a slow loop from drawer to drawer;
// at each stop a drawer slides open, the bee lifts an index card, puts it back
// and the drawer closes. A 1930s lamp (banker's lamp or enamel pendant) warms
// up as the bee nears it and fades slowly after the bee leaves.
//
// Built to sit behind a web page: the room is one cached picture and only the
// open drawer, the card, the bee and the lamp levels are drawn per frame.
// Every motion is a pure function of the frame inside one loop of LOOP frames
// (60 s at 60 fps). The bee enters from the left at frame 0 and leaves at the
// end, after which every lamp is dark again, so the last frame equals the first.
//
// Lighting: the room is drawn once at full brightness; a lit group of plain
// white, blended with `multiply`, then shades everything with the dim ambient
// and the lamps' point lights. Lighting the cached picture itself would replay
// its hundreds of shapes every frame (about 28 ms of GPU instead of about 5).
import type { DeepReadonly, Msg, RootDrawing, Vec2, View } from "@ianbicking/canvas-loop";
import { bee, heldCard, lampHalo, lampLight, lampShade, openDrawer } from "./file-room-actors-tea.js";
import { LAMPS, LOOP, STOPS, beeAt, dwellOf, lampLevel, lerp, liftAmount, openAmount, slotOf, stopAt } from "./file-room-layout-tea.js";
import { roomPicture, windowsPicture } from "./file-room-room-tea.js";

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
  const specs = LAMPS.map((lamp, i) => ({ lamp, level: lampLevel(i, frame) }));

  // The drawer and card of the stop the bee is at; none during the way out.
  const visiting = state.stop < STOPS.length;
  const stop = stopAt(state.stop);
  const d = dwellOf(state.t);
  const open = visiting ? openAmount(d) : 0;
  const lift = visiting ? liftAmount(d) : 0;
  const slot = slotOf(stop.cab, stop.row);
  const side = state.turn >= 0 ? 1 : -1;
  const at: Vec2 = [lerp(slot.x + slot.w / 2, state.x + 30 * side)(lift), lerp(slot.y + 30 * open - 6, state.y + 24)(lift)];
  const card = { at, tilt: 0.12 * Math.sin(frame / 20) * lift };

  return [
    v.background("#07090f"),
    v.group({ effects: { brightness: 2 } }, [v.place(roomPicture(v), 0, 0), openDrawer(v, { stop, open }), lift > 0.001 && heldCard(v, card)]),
    v.group({ blend: "multiply", lighting: { ambient: "#0c1022", shadows: "none", exposure: 0.1, toneCurve: 0.5 } }, [
      v.rect(0, 0, 1600, 900, { fill: "#ffffff" }),
      v.light({ kind: "point", at: [300, 120], height: 160, color: "#7f96d4", energy: 0.3, reach: 700 }),
      v.light({ kind: "point", at: [1300, 120], height: 160, color: "#7f96d4", energy: 0.3, reach: 700 }),
      specs.map((spec) => lampLight(v, spec)),
    ]),
    v.place(windowsPicture(v), 0, 0),
    specs.map((spec) => lampShade(v, spec)),
    specs.map((spec) => lampHalo(v, spec)),
    bee(v, { state, frame }),
  ];
}
