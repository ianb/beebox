// The drawer that slides toward the viewer: a dark opening, the tray of index
// cards seen from above, and the face, which grows and drops as it comes out.
// Its parts are cached pictures placed at a few quantized sizes.
import type { Drawing, Vec2, View } from "@ianbicking/canvas-loop";
import { facePicture, trayPicture } from "./file-room-room-tea.js";
import { type Stop, slotOf } from "./file-room-layout-tea.js";

export interface DrawerSpec {
  stop: Stop;
  /** 0 closed .. 1 fully out. */
  open: number;
}

/** Where a card enters or leaves the open drawer: on the side of the pull nearest the bee. */
export function drawerHand(stop: Stop): Vec2 {
  const s = slotOf(stop.cab, stop.row);
  return [s.x + s.w / 2 + stop.side * 26, s.y + 22];
}

export function openDrawer(v: View, spec: DrawerSpec): Drawing {
  const { stop, open } = spec;
  if (open <= 0.001) return null;
  const s = slotOf(stop.cab, stop.row);
  const cx = s.x + s.w / 2;
  // quarter steps keep the scaled pictures cached; the drop moves smoothly
  const q = Math.max(0.25, Math.round(open * 4) / 4);
  const drop = 18 * open;
  return [
    v.rect(s.x + 2, s.y, s.w - 4, s.h, { fill: "#0a0705" }),
    v.at({ translate: [cx, s.y + 2], scale: [1 + 0.04 * q, q] }, v.place(trayPicture(v), 0, 0)),
    v.rect(cx - 80, s.y + s.h + drop - 4, 160, 10, { fill: "rgba(0,0,0,0.45)" }),
    v.at({ translate: [cx, s.y + 36 + drop], scale: [1 + 0.12 * q, 1 + 0.1 * q] }, v.place(facePicture(v, { cab: stop.cab, row: stop.row }), 0, 0)),
  ];
}
