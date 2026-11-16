import type { Drawing, Style, View } from "@ianbicking/canvas-loop";

export type Kind =
  | "fox"
  | "bear"
  | "cat"
  | "mouse"
  | "rabbit"
  | "dog"
  | "bird"
  | "frog";
export interface Thing {
  id: string;
  x: number;
  y: number;
  kind: Kind | "bus" | "flag" | "clock" | "flowers";
  color: string;
  act: string;
}

export const THINGS: readonly Thing[] = [
  { id: "baker", x: 87, y: 482, kind: "bear", color: "#b87955", act: "loaf" },
  {
    id: "sweeper",
    x: 183,
    y: 493,
    kind: "fox",
    color: "#cd7952",
    act: "sweep",
  },
  {
    id: "mailcarrier",
    x: 395,
    y: 488,
    kind: "rabbit",
    color: "#e6d3a7",
    act: "letters",
  },
  {
    id: "shopkeeper",
    x: 724,
    y: 490,
    kind: "frog",
    color: "#79a474",
    act: "wave",
  },
  {
    id: "painter",
    x: 906,
    y: 483,
    kind: "dog",
    color: "#cba27a",
    act: "ladder",
  },
  {
    id: "gardener",
    x: 129,
    y: 283,
    kind: "mouse",
    color: "#aeb0a1",
    act: "water",
  },
  {
    id: "violinist",
    x: 243,
    y: 283,
    kind: "cat",
    color: "#bd927d",
    act: "music",
  },
  { id: "tailor", x: 449, y: 283, kind: "fox", color: "#cb8c63", act: "cloth" },
  {
    id: "librarian",
    x: 563,
    y: 283,
    kind: "bear",
    color: "#a78e74",
    act: "books",
  },
  {
    id: "astronomer",
    x: 770,
    y: 283,
    kind: "rabbit",
    color: "#e7d4aa",
    act: "stars",
  },
  {
    id: "conductor",
    x: 44,
    y: 566,
    kind: "bird",
    color: "#668ca0",
    act: "whistle",
  },
  {
    id: "cyclist",
    x: 315,
    y: 564,
    kind: "mouse",
    color: "#a8a79d",
    act: "wheel",
  },
  { id: "skater", x: 550, y: 564, kind: "cat", color: "#db9e83", act: "spin" },
  { id: "bus", x: 749, y: 604, kind: "bus", color: "#e3a15b", act: "drive" },
  {
    id: "flag",
    x: 471,
    y: 153,
    kind: "flag",
    color: "#db725f",
    act: "flutter",
  },
  {
    id: "clock",
    x: 496,
    y: 392,
    kind: "clock",
    color: "#f1d99d",
    act: "chime",
  },
  {
    id: "flowers",
    x: 805,
    y: 538,
    kind: "flowers",
    color: "#e8a58d",
    act: "bloom",
  },
];

function fillOf(fill: string): Style {
  return { fill };
}
function lineOf(stroke: string, weight: number): Style {
  return { stroke, weight };
}

/** The drawing of a thing that is not a character, or undefined for a character. */
function paintSpecial(v: View, thing: Thing, pose: boolean): Drawing {
  const { kind, color } = thing;
  if (kind === "bus") {
    return [
      v.rect(1, 8, 149, 56, fillOf("#dc8f57")),
      v.rect(13, 15, 123, 28, fillOf("#f6d391")),
      [0, 1, 2, 3].map((i) => v.rect(20 + i * 29, 19, 22, 19, fillOf("#668e9c"))),
      v.circle(30, 66, 10.5, fillOf("#3e5357")),
      v.circle(119, 66, 10.5, fillOf("#3e5357")),
      v.text(
        "TOWN LOOP",
        { x: 75, y: 57 },
        {
          size: 13,
          fill: "#f8eed0",
          align: "center",
          valign: "baseline",
        },
      ),
    ];
  }
  if (kind === "flag") {
    return [
      v.rect(4, 0, 4, 72, fillOf("#534c4b")),
      v.triangle(8, 5, pose ? 57 : 50, pose ? 21 : 9, 8, 36, fillOf(color)),
    ];
  }
  if (kind === "clock") {
    const hand = lineOf("#344a4c", 3);
    return [
      v.circle(30, 30, 27, fillOf("#f7dfad")),
      v.circle(30, 30, 23, fillOf("#586d70")),
      v.circle(30, 30, 20, fillOf("#f9edce")),
      v.line(30, 30, pose ? 39 : 30, 14, hand),
      v.line(30, 30, pose ? 22 : 42, 35, hand),
    ];
  }
  if (kind === "flowers") {
    return [
      v.rect(3, 34, 65, 32, fillOf("#b07963")),
      [0, 1, 2, 3, 4, 5].map((i) => {
        const x = 10 + i * 10;
        return [
          v.line(x, 39, x, pose ? 13 : 19, lineOf("#668f68", 2)),
          v.circle(x, pose ? 13 : 19, 6.5, fillOf(i % 2 ? "#edacaa" : "#f1d68d")),
        ];
      }),
    ];
  }
  return undefined;
}

function outfit(id: string): string {
  if (id === "baker") return "#f4ead4";
  if (id === "mailcarrier") return "#54849d";
  if (id === "shopkeeper") return "#d4a765";
  if (id === "painter") return "#ebe6c8";
  if (id === "astronomer") return "#71728d";
  if (id === "violinist") return "#b86662";
  return "#547d82";
}

function props(v: View, thing: Thing): Drawing {
  const out: Drawing[] = [];
  if (thing.id === "baker") {
    const f = fillOf("#f9f1db");
    out.push(v.rect(13, 5, 30, 8, f));
    out.push(v.rect(19, 0, 18, 10, f));
  }
  if (thing.id === "mailcarrier") {
    out.push(v.rect(34, 52, 16, 13, fillOf("#d9ae70")));
  }
  if (thing.id === "painter") {
    out.push(v.rect(14, 6, 28, 6, fillOf("#d27c60")));
  }
  if (thing.id === "sweeper") {
    out.push(v.line(50, 52, 54, 82, lineOf("#9b7156", 2)));
    out.push(v.ellipse(54, 80, 6.5, 2.5, fillOf("#e5c99d")));
  }
  if (thing.id === "gardener") {
    out.push(v.ellipse(47, 65, 8.5, 6.5, fillOf("#89aec0")));
    out.push(v.rect(40, 54, 15, 9, fillOf("#89aec0")));
  }
  if (thing.id === "violinist") {
    out.push(v.ellipse(44, 58, 8.5, 5, fillOf("#a86f49")));
    out.push(v.line(49, 51, 51, 35, lineOf("#695648", 2)));
  }
  if (thing.id === "tailor") {
    const f = fillOf("#dfb488");
    out.push(v.triangle(43, 48, 49, 65, 37, 65, f));
    out.push(v.circle(43, 51, 3, f));
  }
  if (thing.id === "librarian") {
    out.push(v.rect(37, 52, 17, 14, fillOf("#be8b61")));
    out.push(v.rect(39, 54, 13, 11, fillOf("#f8e4bd")));
  }
  if (thing.id === "astronomer") {
    out.push(v.line(44, 47, 59, 32, lineOf("#dfbc7d", 5)));
    out.push(v.circle(58, 32, 4.5, fillOf("#f4d997")));
  }
  if (thing.id === "conductor") {
    const f = fillOf("#344f66");
    out.push(v.rect(11, 7, 34, 7, f));
    out.push(v.rect(17, 0, 22, 10, f));
  }
  if (thing.id === "cyclist") {
    out.push(v.rect(15, 8, 27, 6, fillOf("#e8bf7c")));
  }
  if (thing.id === "skater") {
    out.push(v.rect(17, 4, 26, 6, fillOf("#426b77")));
  }
  return out;
}

function paintHead(v: View, kind: Thing["kind"], color: string): Drawing {
  const out: Drawing[] = [];
  const body = fillOf(color);
  if (kind === "rabbit") {
    out.push(v.ellipse(16, 9, 5.5, 17, body));
    out.push(v.ellipse(40, 9, 5.5, 17, body));
  }
  if (kind === "fox") {
    out.push(v.triangle(8, 20, 8, 1, 23, 16, body));
    out.push(v.triangle(33, 16, 48, 1, 48, 20, body));
  }
  if (kind === "cat") {
    out.push(v.triangle(8, 21, 12, 3, 23, 17, body));
    out.push(v.triangle(33, 17, 44, 3, 48, 21, body));
  }
  if (kind === "mouse") {
    out.push(v.circle(10, 14, 9, body));
    out.push(v.circle(46, 14, 9, body));
  }
  if (kind === "bear") {
    out.push(v.circle(12, 15, 7, body));
    out.push(v.circle(44, 15, 7, body));
  }
  if (kind === "frog") {
    out.push(v.circle(15, 11, 7.5, body));
    out.push(v.circle(41, 11, 7.5, body));
  }
  out.push(v.circle(28, 27, 19.5, body));
  out.push(v.ellipse(28, 35, (kind === "fox" ? 29 : 24) / 2, 8.5, fillOf("#f3d6ac")));
  const eye = fillOf("#263d43");
  out.push(v.circle(21, 27, 1.75, eye));
  out.push(v.circle(35, 27, 1.75, eye));
  out.push(v.circle(28, 36, 1.5, eye));
  const mouth = lineOf("#34474a", 1.6);
  out.push(v.arc(28, 39, 5, 0, Math.PI, mouth));
  if (kind === "cat") {
    out.push(v.line(9, 34, 19, 36, mouth));
    out.push(v.line(37, 36, 47, 34, mouth));
  }
  return out;
}

export function paintSprite(v: View, thing: Thing, pose: boolean): Drawing {
  const out: Drawing[] = [];
  const { kind, color } = thing;
  const special = paintSpecial(v, thing, pose);
  if (special !== undefined) return special;
  // A character is drawn around a fixed foot position in a 56×84 sprite.
  const shoe = fillOf("#495459");
  out.push(v.ellipse(19, 76, 8, 4, shoe));
  out.push(v.ellipse(38, 76, 8, 4, shoe));
  out.push(v.ellipse(28, 57, 18, 20, fillOf(outfit(thing.id))));
  if (kind === "fox" || kind === "cat") {
    out.push(v.triangle(9, 62, -3, pose ? 44 : 55, 14, 51, fillOf(color)));
  }
  out.push(paintHead(v, kind, color));
  const arm = lineOf(color, 7);
  out.push(v.line(13, 48, pose ? 2 : 8, pose ? 30 : 61, arm));
  out.push(v.line(43, 48, pose ? 55 : 49, pose ? 32 : 61, arm));
  if (kind === "bird") {
    out.push(v.triangle(28, 34, 48, 38, 28, 42, fillOf("#e7bc70")));
  }
  out.push(props(v, thing));
  return out;
}
