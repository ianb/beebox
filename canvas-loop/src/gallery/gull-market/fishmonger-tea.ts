// The fishmonger behind his counter, too late: cap jumping off his head,
// eyes up and left at the gull, one arm flung out pointing after it, the
// other hand spread in shock, mouth open on "Oi!".
import type { Drawing, PathCommand, Vec2, View } from "@ianbicking/canvas-loop";
import { form, INK, LIGHT, mark, ring, shift } from "./kit-tea.js";

const SKIN = "#f2b48c";
const SKIN_SHADE = "#c9805e";
const JUMPER = "#2f3f6b";
const JUMPER_SHADE = "#1c2747";
const HEAD: Vec2 = [692, 312];

interface LimbSpec {
  pts: readonly Vec2[];
  width: number;
  base: string;
  shade: string;
  seed: number;
}

function limb(v: View, l: LimbSpec): Drawing {
  const outline: PathCommand[] = v.tube(l.pts, {
    width: l.width,
    profile: [
      [0, 1],
      [1, 0.8],
    ],
  });
  return [
    v.path(outline, { fill: l.base }),
    v.clip(outline, [
      mark(
        v,
        shift(l.pts, -LIGHT[0] * l.width * 0.4, -LIGHT[1] * l.width * 0.4),
        {
          color: l.shade,
          weight: l.width * 0.7,
          brush: "wash",
          opacity: 0.8,
          pressure: "even",
          seed: l.seed,
        },
      ),
    ]),
    v.path(outline, {
      stroke: INK,
      weight: 2.6,
      brush: "ink",
      gesture: { pressure: "swell", wobble: 0.5, seed: l.seed + 1 },
    }),
  ];
}

export function fishmonger(v: View): Drawing {
  const out: Drawing[] = [];
  // torso and apron
  const torso: Vec2[] = [
    [608, 470],
    [614, 398],
    [636, 366],
    [692, 352],
    [750, 366],
    [774, 402],
    [782, 470],
  ];
  out.push(form(v, torso, {
    base: JUMPER,
    shade: JUMPER_SHADE,
    light: "#4b5f94",
    strokes: "#4b5f94",
    depth: 22,
    weight: 3,
    seed: 1001,
  }));
  const apron: Vec2[] = [
    [648, 398],
    [738, 398],
    [752, 470],
    [634, 470],
  ];
  out.push(form(v, apron, {
    base: "#f6f3ea",
    shade: "#cfd6de",
    depth: 12,
    sharp: true,
    weight: 2.2,
    seed: 1002,
  }));
  out.push(v.clip(apron, ((): Drawing => {
    const drawn: Drawing[] = [];
    for (let i = 0; i < 6; i += 1) {
      const x = 640 + i * 20;
      drawn.push(mark(
        v,
        [
          [x, 396],
          [x + (i - 2.5) * 2, 472],
        ],
        {
          color: "#3e86b8",
          weight: 5,
          brush: "marker",
          pressure: "even",
          seed: 1010 + i,
        },
      ));
    }
    return drawn;
  })()));
  out.push(mark(
    v,
    [
      [652, 398],
      [660, 362],
    ],
    { color: "#f6f3ea", weight: 6, pressure: "even" },
  ));
  out.push(mark(
    v,
    [
      [734, 398],
      [726, 362],
    ],
    { color: "#f6f3ea", weight: 6, pressure: "even" },
  ));
  // the shocked arm, hand spread
  out.push(limb(v, {
    pts: [
      [758, 384],
      [796, 352],
      [814, 312],
    ],
    width: 28,
    base: JUMPER,
    shade: JUMPER_SHADE,
    seed: 1020,
  }));
  out.push(spreadHand(v));
  // the pointing arm: jumper sleeve to the elbow, bare forearm to the hand
  out.push(limb(v, {
    pts: [
      [628, 386],
      [598, 360],
      [584, 346],
    ],
    width: 30,
    base: JUMPER,
    shade: JUMPER_SHADE,
    seed: 1030,
  }));
  out.push(limb(v, {
    pts: [
      [590, 352],
      [568, 330],
      [552, 314],
    ],
    width: 22,
    base: SKIN,
    shade: SKIN_SHADE,
    seed: 1040,
  }));
  out.push(form(v, ring(548, 310, 13, 11), {
    base: SKIN,
    shade: SKIN_SHADE,
    depth: 5,
    weight: 2.4,
    seed: 1041,
  }));
  out.push(limb(v, {
    pts: [
      [540, 304],
      [526, 294],
      [516, 288],
    ],
    width: 8,
    base: SKIN,
    shade: SKIN_SHADE,
    seed: 1042,
  }));
  out.push(head(v));
  return out;
}

function spreadHand(v: View): Drawing {
  const out: Drawing[] = [];
  const palm: Vec2 = [818, 300];
  for (const [i, a] of [-2.3, -1.85, -1.4, -0.95, -0.35].entries()) {
    const len = i === 4 ? 14 : 20;
    out.push(limb(v, {
      pts: [palm, [palm[0] + Math.cos(a) * len, palm[1] + Math.sin(a) * len]],
      width: 7,
      base: SKIN,
      shade: SKIN_SHADE,
      seed: 1050 + i,
    }));
  }
  out.push(form(v, ring(palm[0], palm[1], 12, 12), {
    base: SKIN,
    shade: SKIN_SHADE,
    depth: 5,
    weight: 2.2,
    seed: 1060,
  }));
  return out;
}

function head(v: View): Drawing {
  const out: Drawing[] = [];
  const [hx, hy] = HEAD;
  out.push(form(v, ring(hx - 38, hy + 4, 8, 11), {
    base: SKIN,
    shade: SKIN_SHADE,
    depth: 4,
    weight: 2,
    seed: 1101,
  }));
  out.push(form(v, ring(hx + 38, hy + 4, 8, 11), {
    base: SKIN,
    shade: SKIN_SHADE,
    depth: 4,
    weight: 2,
    seed: 1102,
  }));
  out.push(form(v, ring(hx, hy, 38, 42, 20), {
    base: SKIN,
    shade: SKIN_SHADE,
    light: "#ffd7bb",
    depth: 12,
    weight: 3,
    seed: 1103,
  }));
  // grey hair around the sides, bald crown (his cap has just left it)
  for (const side of [-1, 1]) {
    out.push(mark(
      v,
      [
        [hx + side * 30, hy - 26],
        [hx + side * 37, hy - 12],
        [hx + side * 36, hy + 2],
      ],
      { color: "#9aa0a6", weight: 6, brush: "chalk", seed: 1110 + side },
    ));
  }
  // cheeks
  out.push(v.circle(hx - 22, hy + 14, 9, { fill: "rgba(226,92,80,0.35)" }));
  out.push(v.circle(hx + 22, hy + 14, 9, { fill: "rgba(226,92,80,0.35)" }));
  // eyes wide, looking up and left after the gull
  for (const ex of [hx - 15, hx + 14]) {
    out.push(v.ellipse(ex, hy - 8, 8.5, 9.5, { fill: "#ffffff", stroke: INK, weight: 2 }));
    out.push(v.circle(ex - 4, hy - 12, 3.5, { fill: INK }));
    out.push(mark(
      v,
      [
        [ex - 10, hy - 24],
        [ex, hy - 30],
        [ex + 9, hy - 25],
      ],
      { color: "#6b6f75", weight: 4, seed: 1120 + ex },
    ));
  }
  // nose, moustache, open mouth
  out.push(form(v, ring(hx + 1, hy + 6, 9, 8), {
    base: "#e98f73",
    shade: "#c26a52",
    depth: 4,
    weight: 2,
    seed: 1130,
  }));
  out.push(form(v, ring(hx + 1, hy + 31, 9, 11), {
    base: "#5a1f24",
    shade: "#3a1015",
    depth: 3,
    weight: 2.2,
    seed: 1131,
  }));
  out.push(v.ellipse(hx + 1, hy + 37, 5, 3, { fill: "#d9606a" }));
  const tache: Vec2[] = [
    [hx - 26, hy + 22],
    [hx - 14, hy + 12],
    [hx + 1, hy + 17],
    [hx + 16, hy + 12],
    [hx + 28, hy + 22],
    [hx + 12, hy + 23],
    [hx + 1, hy + 20],
    [hx - 10, hy + 23],
  ];
  out.push(form(v, tache, {
    base: "#b8b2a8",
    shade: "#7d776e",
    depth: 4,
    weight: 2,
    seed: 1132,
  }));
  out.push(cap(v));
  return out;
}

function cap(v: View): Drawing {
  const out: Drawing[] = [];
  out.push(v.at({ translate: [HEAD[0] + 26, HEAD[1] - 56], rotate: 0.42 }, ((): Drawing => {
    const crown: Vec2[] = [
      [-34, 4],
      [-26, -14],
      [6, -20],
      [32, -8],
      [36, 6],
    ];
    return [
      form(v, crown, {
        base: "#5d6b5a",
        shade: "#3c473a",
        light: "#8a9a85",
        depth: 6,
        weight: 2.6,
        seed: 1140,
      }),
      form(
        v,
        [
          [22, 2],
          [52, 4],
          [54, 10],
          [24, 10],
        ],
        { base: "#4a5648", shade: "#323b30", depth: 3, weight: 2.2, seed: 1141 },
      ),
    ];
  })()));
  // jump lines under the cap
  for (const [i, x] of [700, 718, 736].entries()) {
    out.push(mark(
      v,
      [
        [x, 276 - i * 2],
        [x + 4, 266 - i * 2],
      ],
      { color: INK, weight: 2.4, seed: 1150 + i },
    ));
  }
  return out;
}

export function shock(v: View): Drawing {
  // a jagged burst with "OI!" in it, up by his pointing hand
  const c: Vec2 = [604, 236];
  const pts: Vec2[] = [];
  for (let i = 0; i < 18; i += 1) {
    const a = (i / 18) * Math.PI * 2;
    const r = i % 2 === 0 ? 40 : 28;
    pts.push([c[0] + Math.cos(a) * r * 1.25, c[1] + Math.sin(a) * r]);
  }
  return [
    form(v, pts, {
      base: "#fff3a8",
      shade: "#f2c94c",
      depth: 6,
      sharp: true,
      weight: 2.6,
      seed: 1160,
    }),
    v.text(
      "OI!",
      { x: c[0], y: c[1] + 1 },
      {
        fill: "#c0302a",
        font: "Georgia, serif",
        style: "bold",
        size: 26,
        align: "center",
        valign: "middle",
      },
    ),
  ];
}
