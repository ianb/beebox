import type {
  DeepReadonly,
  Msg,
  ParamsDecl,
  ParamValues,
  Style,
  Util,
  View,
} from "@ianbicking/canvas-loop";
import { paintOccupiedWindowTrim, paintTown } from "./town-tea.js";
import { THINGS, paintSprite, type Thing } from "./people-tea.js";

export const canvas = { width: 1000, height: 700 };
export const params = {
  dusk: { type: "boolean", default: false },
  reset: { type: "trigger" },
} as const satisfies ParamsDecl;
type Params = ParamValues<typeof params>;
export interface Model {
  frame: number;
  hover: string;
  acts: Readonly<Record<string, number>>;
}

export function init(): Model {
  return { frame: 0, hover: "", acts: {} };
}

function busShift(t: Thing, model: DeepReadonly<Model>): number {
  if (t.kind !== "bus") return 0;
  const age = model.frame - (model.acts.bus ?? -1000);
  return age >= 0 && age < 72
    ? Math.sin((Math.min(age, 70) / 70) * Math.PI) * 96
    : 0;
}

function bounds(
  t: Thing,
  x: number,
  y: number,
  model: DeepReadonly<Model>,
): boolean {
  if (t.kind === "bus")
    return (
      x > t.x + busShift(t, model) - 76 &&
      x < t.x + busShift(t, model) + 76 &&
      y > t.y - 78 &&
      y < t.y + 2
    );
  if (t.kind === "flag")
    return x > t.x - 35 && x < t.x + 35 && y > t.y - 76 && y < t.y;
  const upper = t.y < 300;
  return (
    Math.abs(x - t.x) < (upper ? 24 : 31) &&
    y > t.y - (upper ? 67 : 83) &&
    y < t.y + 10
  );
}
function hit(x: number, y: number, model: DeepReadonly<Model>): string {
  return THINGS.findLast((t) => bounds(t, x, y, model))?.id ?? "";
}

function showHitAreas(v: View, model: DeepReadonly<Model>): void {
  for (const t of THINGS) {
    if (t.kind === "bus")
      v.debugBox(t.id, t.x + busShift(t, model) - 76, t.y - 78, 152, 80);
    else if (t.kind === "flag") v.debugBox(t.id, t.x - 35, t.y - 76, 70, 76);
    else {
      const upper = t.y < 300;
      v.debugBox(
        t.id,
        t.x - (upper ? 24 : 31),
        t.y - (upper ? 67 : 83),
        upper ? 48 : 62,
        upper ? 77 : 93,
      );
    }
  }
}

export function update(
  model: DeepReadonly<Model>,
  msg: Msg,
  u: Util<typeof params>,
): Model {
  switch (msg.type) {
    case "tick":
      return { ...model, frame: msg.frame };
    case "mousemove": {
      const hover = hit(msg.x, msg.y, model);
      return hover === model.hover ? model : { ...model, hover };
    }
    case "mousedown": {
      const id = hit(msg.x, msg.y, model);
      if (!id) return model;
      u.handled(id);
      const chain: Readonly<Record<string, string>> = {
        baker: "sweeper",
        violinist: "skater",
        bus: "conductor",
        flag: "astronomer",
        clock: "mailcarrier",
      };
      const other = chain[id];
      return {
        ...model,
        acts: {
          ...model.acts,
          [id]: model.frame,
          ...(other ? { [other]: model.frame + 8 } : {}),
        },
      };
    }
    case "trigger":
      return msg.name === "reset" ? init() : model;
    case "mouseup":
    case "keydown":
    case "keyup":
    case "param":
      return model;
  }
}

const TREBUCHET = "Trebuchet MS";
const fillOf = (fill: string): Style => ({ fill });
const lineOf = (stroke: string, weight: number): Style => ({ stroke, weight });

function label(v: View, text: string, x: number, y: number): void {
  v.rect(x - 34, y - 17, 68, 20, fillOf("#fff3d9"));
  v.text(
    text,
    { x, y: y - 3 },
    {
      size: 10,
      font: TREBUCHET,
      style: "bold",
      fill: "#405657",
      align: "center",
      valign: "baseline",
    },
  );
}

function notes(v: View, x: number, y: number, age: number): void {
  const opts = { size: 22, fill: "#506f86", valign: "baseline" } as const;
  v.text("♪", { x: x + age * 0.5, y: y - age * 0.8 }, opts);
  v.text("♫", { x: x + 14 + age * 0.3, y: y - 23 - age * 0.5 }, opts);
}

function actEffectA(v: View, t: Thing, age: number): void {
  const x = t.x,
    y = t.y,
    s = Math.sin(age * 0.2);
  switch (t.act) {
    case "loaf":
      v.ellipse(x + 28, y - 46 - age * 0.08, 31, 16, fillOf("#e6ad69"));
      for (let i = 0; i < 3; i += 1) {
        v.circle(
          x + 23 + i * 8,
          y - 66 - ((age + i * 13) % 28),
          4,
          fillOf("#fff4d8"),
        );
      }
      break;
    case "sweep":
      v.line(x + 25, y - 38, x + 35 + s * 14, y + 5, lineOf("#8a644d", 3));
      v.ellipse(x + 35 + s * 14, y + 5, 22, 7, fillOf("#e1cf9e"));
      break;
    case "letters":
      for (let i = 0; i < 4; i += 1) {
        v.rect(
          x + 10 + i * 8 + age * 0.18,
          y - 57 - i * 13 - age * 0.3,
          15,
          10,
          fillOf("#fff4d7"),
        );
      }
      break;
    case "wave":
      v.circle(x + 34, y - 72 + s * 8, 8, fillOf("#f1dbab"));
      break;
    case "ladder": {
      const rail = lineOf("#956c54", 4);
      v.line(x + 27, y - 5, x + 27 + s * 7, y - 119, rail);
      v.line(x + 48, y - 5, x + 48 + s * 7, y - 119, rail);
      for (let i = 0; i < 5; i += 1)
        v.line(
          x + 27 + s * 7,
          y - 16 - i * 20,
          x + 48 + s * 7,
          y - 16 - i * 20,
          rail,
        );
      break;
    }
    case "water":
      for (let i = 0; i < 6; i += 1)
        v.circle(
          x + 20 + i * 7,
          y - 30 + ((age + i * 9) % 40),
          4,
          fillOf("#85afc9"),
        );
      break;
    case "music":
      notes(v, x, y - 78, age);
      break;
    case "cloth":
      v.triangle(
        x + 24,
        y - 54,
        x + 75 + s * 9,
        y - 67,
        x + 67,
        y - 16,
        fillOf("#da8b8b"),
      );
      break;
    default:
      break;
  }
}

function actEffectB(v: View, t: Thing, age: number, frame: number): void {
  const x = t.x,
    y = t.y,
    s = Math.sin(age * 0.2);
  switch (t.act) {
    case "books":
      for (let i = 0; i < 4; i += 1) {
        v.rect(
          x + 23 + i * 9,
          y - 46 - (age % 18) * 0.5 - i * 5,
          7,
          20,
          fillOf(i % 2 ? "#d58f67" : "#6a9690"),
        );
      }
      break;
    case "stars":
      for (let i = 0; i < 5; i += 1) {
        v.circle(
          x - 44 + i * 19,
          y - 89 + Math.sin(frame * 0.12 + i) * 9,
          4 + (i % 2) * 3,
          fillOf("#f9e5a0"),
        );
      }
      break;
    case "whistle":
      notes(v, x, y - 72, age * 0.6);
      break;
    case "wheel": {
      const rim = lineOf("#4c6266", 3);
      v.circle(x + 20, y - 4, 30 + age * 0.3, rim);
      v.circle(x - 24, y - 4, 30 + age * 0.3, rim);
      break;
    }
    case "spin":
      v.arc(
        x,
        y - 45,
        35,
        age * 0.13,
        age * 0.13 + Math.PI * 1.5,
        lineOf("#e8bd83", 3),
      );
      break;
    case "drive":
      for (let i = 0; i < 3; i += 1)
        v.ellipse(x - 90 - i * 14, y + 16, 19, 8, fillOf("#e8ddc4"));
      break;
    case "flutter":
      v.circle(x + 61, y - 50 + s * 8, 5, fillOf("#f2c36f"));
      break;
    case "chime":
      v.circle(x, y - 27, 65 + age * 0.8, lineOf("#eecb7e", 3));
      break;
    case "bloom":
      for (let i = 0; i < 5; i += 1)
        v.circle(x - 24 + i * 12, y - 59 - age * 0.38, 4, fillOf("#f8dfa1"));
      break;
    default:
      break;
  }
}

function poseAngle(
  t: Thing,
  model: DeepReadonly<Model>,
  age: number,
  active: boolean,
): number | undefined {
  if (t.kind === "flag") return Math.sin(model.frame * 0.11) * 0.035;
  if (t.kind === "bus" || t.kind === "clock" || t.kind === "flowers")
    return undefined;
  if (!active) return Math.sin(model.frame * 0.045 + t.x) * 0.012;
  return t.act === "spin" ? age * 0.13 : Math.sin(age * 0.22) * 0.09;
}

function drawThing(v: View, t: Thing, model: DeepReadonly<Model>): void {
  const age = model.frame - (model.acts[t.id] ?? -1000);
  const active = age >= 0 && age < 72;
  const hovered = model.hover === t.id;
  const bus = t.kind === "bus";
  const flag = t.kind === "flag";
  const special = bus || flag || t.kind === "clock" || t.kind === "flowers";
  const width = bus ? 152 : flag ? 70 : special ? 72 : 56;
  const height = bus ? 78 : flag ? 76 : special ? 72 : 84;
  const pose = active && age % 28 < 18;
  const sprite = v.sprite(
    { key: `town-${t.id}-${pose ? "act" : "idle"}`, width, height },
    () => paintSprite(v, t, pose),
  );
  const idle = Math.sin(model.frame * 0.055 + t.x) * 1.4;
  const hop = hovered ? Math.sin(model.frame * 0.22) * 3.8 : 0;
  const shift = busShift(t, model);
  const angle = poseAngle(t, model, age, active);
  v.at(
    {
      translate: [t.x + shift, t.y + idle - hop],
      ...(angle === undefined ? {} : { rotate: angle }),
      ...(t.y < 300 && !special ? { scale: 0.75 } : {}),
    },
    () => {
      v.image(sprite, -width / 2, -height);
    },
  );
  if (active) {
    actEffectA(v, t, age);
    actEffectB(v, t, age, model.frame);
  }
  if (hovered) {
    v.circle(
      t.x + shift,
      t.y - height * 0.56,
      Math.min(width, 66) + 8 + Math.sin(model.frame * 0.25) * 4,
      lineOf("#fff6ce", 2),
    );
    label(
      v,
      t.id.toUpperCase(),
      t.x + shift,
      t.kind === "flowers" ? t.y - 90 : t.y < 300 ? t.y - 88 : t.y + 25,
    );
  }
}

export function draw(v: View, model: DeepReadonly<Model>, p: Params): void {
  v.cache(`busy-town-${p.dusk}`, () => paintTown(v, p.dusk));
  v.cursor(model.hover ? "pointer" : "default");
  for (const t of THINGS) drawThing(v, t, model);
  paintOccupiedWindowTrim(v);
  showHitAreas(v, model);
  // A few tiny looping marks make the printed street breathe even at rest.
  for (let i = 0; i < 3; i += 1) {
    const x = 52 + i * 324;
    const dy = Math.sin(model.frame * 0.06 + i) * 5;
    v.arc(x, 533 + dy, 10, 0, Math.PI, lineOf("#f9edcd", 2));
  }
  v.text(
    "WILLOW WICK • click anyone and see what happens",
    { x: 27, y: 686 },
    {
      size: 11,
      fill: "#4a6262",
      align: "left",
      valign: "baseline",
    },
  );
}
