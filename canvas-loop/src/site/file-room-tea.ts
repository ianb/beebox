// A tall archive at night, almost entirely dark. Five levels, each a plank
// platform with a cabinet and a lamp in the left third and in the right third,
// joined by ladders on the outer edges. A small bee in a striped jumper and
// green eyeshade, a clerk, walks down through the archive: takes an index card
// from one drawer, carries it across the dark middle (the page card hides
// that stretch), files it in another, climbs down a ladder and goes on. A
// cabinet's lamp warms up as they arrive and fades after they leave, so pools
// of light appear in the dark and go out again. Their pronoun is "they".
//
// Drawn like an illustration made by hand: ink and pencil strokes with wobble,
// bristle paint, hatched shadow, paper grain. Still parts are cached pictures;
// per frame only the open drawer, the clerk, the card and the lamp levels
// change. Every motion is a pure function of the frame inside one loop: the
// room is dark and empty at frame 0 and again at the end.
//
// Variations: the cycle number (frames / LOOP, plus the `cycle` param) picks,
// deterministically, how high drawers are reached (a wing-flutter hop, or
// accordion stilts in some cycles) and, in some cycles, one small easter egg.
// The `variation` param forces one. See `planFor` in the layout file.
//
// Lighting: the room is drawn once at full brightness; a lit group of plain
// white, blended with `multiply`, then darkens it everywhere except where a
// lamp's point light reaches. (Lighting the cached pictures directly would
// replay all their shapes every frame.)
import type { DeepReadonly, Drawing, Msg, Picture, ParamValues, ParamsDecl, RootDrawing, View } from "@ianbicking/canvas-loop";
import { actAt } from "./file-room-act-tea.js";
import { clerk } from "./file-room-clerk-tea.js";
import { openDrawer } from "./file-room-drawer-tea.js";
import { type LampSpec, lampHalo, lampLight, lampShade } from "./file-room-lamps-tea.js";
import { CABS, GROUND_OFF, HEIGHT, K, LADDER_X, LEVELS, LEVEL_GAP, VARIATIONS, WIDTH, bandBottom, bandTop, cabAt, cabBase, levelFloor, planFor, stopAt } from "./file-room-layout-tea.js";
import { moth } from "./file-room-moth-tea.js";
import { LOOP, beeAt, lampLevel } from "./file-room-path-tea.js";
import { cabinetPicture, floorPicture, ladderPicture, platformPicture } from "./file-room-room-tea.js";

export const params = {
  variation: { type: "select", options: VARIATIONS, default: "auto", label: "Variation", hint: "auto: chosen from the cycle number; or force stilts, a hop, or one easter egg" },
  cycle: { type: "number", min: 0, max: 99, step: 1, default: 0, label: "Cycle offset", hint: "added to the loop count when `auto` chooses" },
} as const satisfies ParamsDecl;

export const canvas = { width: WIDTH, height: HEIGHT };

export interface Model {
  /** Frame within the loop, 0 .. LOOP - 1. */
  frame: number;
  /** How many loops have passed. */
  loop: number;
}

export function init(): Model {
  return { frame: 0, loop: 0 };
}

export function update(model: DeepReadonly<Model>, msg: Msg): Model {
  return msg.type === "tick" ? { frame: msg.frame % LOOP, loop: Math.floor(msg.frame / LOOP) } : model;
}

const LEVEL_LIST = Array.from({ length: LEVELS }, (_, k) => k);
/** Colour an unlit level's pictures are drawn in: nearly black, with just enough edge to sense. */
const DARK = "rgba(1,1,3,0.985)";

function levelScene(v: View, spec: { k: number }): Drawing {
  const { k } = spec;
  return [
    v.place(floorPicture(v), 0, levelFloor(k) - 80),
    v.place(platformPicture(v), 0, levelFloor(k)),
    [2 * k, 2 * k + 1].map((i) => v.at({ translate: [cabAt(i).x, cabBase(i)], scale: K }, v.place(cabinetPicture(v, cabAt(i).variant), 0, 0))),
  ];
}

/** The whole archive at rest, drawn once: every level, ladder, cabinet and unlit lamp. */
function worldPicture(v: View): Picture {
  return v.picture({ key: "world", width: WIDTH, height: HEIGHT }, () => [
    LEVEL_LIST.slice(0, -1).map((k) => Object.values(LADDER_X).map((x) => v.place(ladderPicture(v, LEVEL_GAP + GROUND_OFF + 30), x, levelFloor(k) - 30))),
    LEVEL_LIST.map((k) => levelScene(v, { k })),
    CABS.map((_, cab) => lampShade(v, { cab, level: 0 })),
  ]);
}

const bandOf = (y: number): number => Math.max(0, Math.min(LEVELS - 1, LEVEL_LIST.findLast((k) => y >= bandTop(k)) ?? 0));

// eslint-disable-next-line max-params -- TEA contract signature
export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): RootDrawing {
  const { frame } = model;
  const plan = planFor(model.loop + p.cycle, p.variation);
  const state = beeAt(frame, plan.egg === "drop");
  const act = actAt(state, plan);
  const lamps: LampSpec[] = CABS.map((_, cab) => ({ cab, level: lampLevel(cab, frame) }));
  const stop = stopAt(state.stop);
  const mothCab = 4;
  const clerkBand = state.visible ? bandOf(state.y) : -1;
  // Only a level with a lit lamp or the clerk goes through the lighting passes; the rest is drawn dark.
  const active = LEVEL_LIST.map((k) => clerkBand === k || lamps.some((l) => cabAt(l.cab).level === k && l.level > 0.004));

  return [
    v.background("#000000"),
    v.place(worldPicture(v), 0, 0, { tint: DARK }),
    LEVEL_LIST.map((k) => {
      if (!active[k]) return null;
      const top = bandTop(k);
      const height = bandBottom(k) - top;
      return [
        v.group({ effects: { brightness: 2, paper: 0.3 } }, [
          levelScene(v, { k }),
          state.stop >= 0 && cabAt(stop.cab).level === k && openDrawer(v, { stop, open: act.open, gap: act.gap }),
          clerkBand === k && clerk(v, { state, act, frame }),
        ]),
        v.group({ blend: "multiply", lighting: { ambient: "#020204", shadows: "none", exposure: 0, toneCurve: 0.5 } }, [
          v.rect(0, top, WIDTH, height, { fill: "#ffffff" }),
          v.light({ kind: "point", at: [800, top + height], height: 200, color: "#6f86c8", energy: 0.05, reach: 900 }),
          lamps.filter((l) => cabAt(l.cab).level === k).map((spec) => lampLight(v, spec)),
        ]),
      ];
    }),
    lamps.filter((l) => l.level > 0.004 || active[cabAt(l.cab).level]).map((spec) => lampShade(v, spec)),
    lamps.map((spec) => lampHalo(v, spec)),
    plan.egg === "moth" && moth(v, { cab: mothCab, level: lampLevel(mothCab, frame), frame }),
  ];
}
