// Each frame: the painted board, the stains of battle, the cast lane by lane in
// their poses, ink in flight, the splashes, the cards and counters, banners,
// and the hover cue. Each pose of each character is a kept picture.
import type { DeepReadonly, Drawing, Picture, RootDrawing, TextOptions, View } from "@ianbicking/canvas-loop";
import { CAT_AT, MOCHI_AT, type CardState, paintBoard, paintCard, paintCat, paintMochi, paintRibbon, paintRoller } from "./board-tea.js";
import { INK, OCHRE, PAPER, VERMILION, blob, clamp01, ellipsePts, rgba } from "./brush-tea.js";
import { type DefPose, FOOT_X, FOOT_Y, type FoePose, PIC_H, PIC_W, type Wear, paintBlot, paintDefender, paintDrop, paintFoe, paintStampMark } from "./cast-tea.js";
import { AGAIN, CARD_H, CARD_W, CARD_Y, CH, CW, DEFS, DEF_KINDS, type DefKind, type Defender, FOES, type Foe, type Fx, FX_LIFE, type Game, H, ROWS, SEAL_FALL, TOTAL_FOES, W, WAVES, WAVE_COUNT, WAVE_NAMES, cardAt, cardX, cellAt, cellX, cellY, defCentre, dropAt, dropHit, occupied, rowFeet } from "./rules-tea.js";

export interface Shake { readonly at: number; readonly amp: number }
export interface Scene {
  readonly frame: number;
  readonly game: DeepReadonly<Game>;
  readonly mouse: readonly [number, number] | null;
  readonly shake: Shake;
}

const SERIF = "Georgia, 'Times New Roman', serif";
const HINT: TextOptions = { overlay: true, size: 14, font: SERIF, style: "italic", fill: INK, halo: "rgba(248,241,222,0.95)", keepInside: true };

/** Each cast picture is washed like watercolour and pressed into the paper once, when its pose is first drawn. */
const CAST_PAINT = { wash: { edges: 0.55, granulate: 0.6, blotch: 0.3 }, paper: 0.35 } as const;

// --- Pictures --------------------------------------------------------------------------

function defPic(v: View, kind: DefKind, pose: DefPose, wear: Wear): Picture {
  return v.picture({ key: "def", width: PIC_W, height: PIC_H, deps: [kind, pose, wear] }, () => v.group({ effects: CAST_PAINT }, paintDefender(v, kind, pose, wear)));
}
function foePic(v: View, kind: Foe["kind"], pose: FoePose, hurt: boolean): Picture {
  return v.picture({ key: "foe", width: PIC_W, height: PIC_H, deps: [kind, pose, hurt] }, () => v.group({ effects: CAST_PAINT }, paintFoe(v, kind, pose, hurt)));
}

// --- Poses -------------------------------------------------------------------------------

const acting = (d: DeepReadonly<Defender>, t: number, lasts: number): boolean => d.last !== d.at && t - d.last < lasts;

function defPose(d: DeepReadonly<Defender>, t: number): DefPose {
  const age = t - d.at;
  if (age < 5) return "pop0";
  if (age < 10) return "pop1";
  if (age < 16) return "pop2";
  const blink = (t + d.id * 37) % 220 < 9;
  switch (d.kind) {
    case "inkstone": return acting(d, t, 30) ? "act" : blink ? "blink" : "idle";
    case "crane": return acting(d, t, 14) ? "act" : (t + d.id * 13) % 90 < 45 ? "blink" : "idle";
    case "tiger": return acting(d, t, 18) ? "act" : (t + d.id * 53) % 140 < 70 ? "blink" : "idle";
    case "screen": return blink ? "blink" : "idle";
    case "seal": return "idle";
  }
}
const wearOf = (d: DeepReadonly<Defender>): Wear => {
  const f = d.hp / DEFS[d.kind].hp;
  return f > 0.66 ? 0 : f > 0.33 ? 1 : 2;
};

const CYCLE: Record<Foe["kind"], number> = { umbrella: 48, sandal: 24, kettle: 60, lantern: 72 };

function foePose(f: DeepReadonly<Foe>, t: number): { pose: FoePose; lift: number } {
  const float = f.kind === "lantern" ? 16 + Math.sin((t + f.seed) * 0.08) * 5 : 0;
  if (t - f.hitAt < 8) return { pose: "hit", lift: float };
  if (f.eating) return { pose: Math.floor((t + f.seed) / 12) % 2 === 0 ? "bite0" : "bite1", lift: float };
  const n = CYCLE[f.kind];
  const ph = ((t - f.born + f.seed) % n) / n;
  const k = Math.min(5, Math.floor(ph * 6));
  const pose: FoePose = k === 0 ? "walk0" : k === 1 ? "walk1" : k === 2 ? "walk2" : k === 3 ? "walk3" : k === 4 ? "walk4" : "walk5";
  const lift = f.kind === "umbrella" ? (ph > 0.3 ? Math.sin((Math.PI * (ph - 0.3)) / 0.7) * 16 : 0) : f.kind === "sandal" ? Math.abs(Math.sin(ph * Math.PI * 2)) * 3 : float;
  return { pose, lift };
}

// --- The lanes ---------------------------------------------------------------------------

function defender(v: View, d: DeepReadonly<Defender>, t: number): Drawing {
  const cx = defCentre(d), feet = rowFeet(d.row);
  if (d.kind === "seal") {
    const age = t - d.at;
    const u = clamp01(age / SEAL_FALL);
    const drop = (1 - u * u) * 220;
    const pose: DefPose = age >= SEAL_FALL && age < SEAL_FALL + 6 ? "pop0" : age >= SEAL_FALL + 6 && age < SEAL_FALL + 12 ? "pop2" : "idle";
    const fade = clamp01(1 - (age - SEAL_FALL - 12) / 12);
    if (fade < 0.12) return null;
    return [
      age < SEAL_FALL && v.ellipse(cx, feet - 30, 20 + u * 26, 6 + u * 8, { fill: rgba(INK, 0.08 + u * 0.18) }),
      v.place(defPic(v, "seal", pose, 0), Math.round(cx - FOOT_X), Math.round(feet - 20 - drop - FOOT_Y), { opacity: fade }),
    ];
  }
  const shaking = t - d.hitAt < 4 ? ((t % 4) < 2 ? -1 : 1) : 0;
  return v.place(defPic(v, d.kind, defPose(d, t), d.kind === "screen" ? wearOf(d) : 0), Math.round(cx - FOOT_X + shaking), Math.round(feet - FOOT_Y));
}

function foe(v: View, f: DeepReadonly<Foe>, t: number): Drawing {
  const { pose, lift } = foePose(f, t);
  const hurt = f.kind === "kettle" && f.hp < FOES.kettle.hp * 0.5;
  return v.place(foePic(v, f.kind, pose, hurt), Math.round(f.x - FOOT_X), Math.round(rowFeet(f.row) - lift - FOOT_Y));
}

function lanesDrawing(v: View, g: DeepReadonly<Game>): Drawing {
  const blot = v.picture({ key: "blot", width: 40, height: 28 }, () => paintBlot(v));
  return Array.from({ length: ROWS }, (_, r) => [
    g.defenders.filter((d) => d.row === r).map((d) => defender(v, d, g.t)),
    g.foes.filter((f) => f.row === r).toSorted((a, b) => b.x - a.x).map((f) => foe(v, f, g.t)),
    g.shots.filter((s) => s.row === r).map((s) => v.place(blot, Math.round(s.x - 34), Math.round(rowFeet(r) - 46 + Math.sin((g.t - s.born) * 0.5) * 1.5))),
  ]);
}

function stains(v: View, g: DeepReadonly<Game>): Drawing {
  return g.stains.map((s) => {
    const pic = s.red
      ? v.picture({ key: "stamp", width: 90, height: 90 }, () => v.at({ translate: [45, 45] }, paintStampMark(v, 77)))
      : v.picture({ key: "stain", width: 70, height: 30, deps: [s.seed % 4] }, () => blob(v, ellipsePts(35, 15, 24 + (s.seed % 4) * 2, 7, 14), { fill: rgba(INK, 0.5), seed: s.seed % 4, line: 0, amp: 3 }));
    const life = (g.t - s.at) / 900;
    const a = clamp01((1 - life) * 1.4) * (s.red ? 0.85 : 0.6);
    if (a < 0.12) return null;
    return s.red ? v.place(pic, Math.round(s.x - 45), Math.round(s.y - 45), { opacity: a }) : v.place(pic, Math.round(s.x - 35), Math.round(s.y - 15), { opacity: a });
  });
}

// --- Splashes and bits -------------------------------------------------------------------

const rnd = (seed: number, k: number): number => {
  const h = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return h - Math.floor(h);
};

function fx(v: View, e: DeepReadonly<Fx>, t: number): Drawing {
  const age = t - e.at;
  switch (e.kind) {
    case "splat": {
      const u = age / 22;
      return [
        v.circle(e.x, e.y, 6 + u * 10, { fill: rgba(INK, 0.5 * (1 - u)) }),
        [0, 1, 2, 3, 4, 5].map((k) => {
          const a = rnd(e.seed, k) * Math.PI * 2, sp = 1.5 + rnd(e.seed, k + 9) * 2.5;
          return v.circle(e.x + Math.cos(a) * sp * age, e.y + Math.sin(a) * sp * age + age * age * 0.04, 3 * (1 - u) + 0.5, { fill: INK });
        }),
      ];
    }
    case "poof": {
      const u = age / 46;
      return [
        [0, 1, 2, 3, 4, 5, 6].map((k) => {
          const a = (k / 7) * Math.PI * 2 + rnd(e.seed, k);
          const d = 8 + u * 30 * (0.6 + rnd(e.seed, k + 3) * 0.6);
          return v.circle(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d * 0.7 - u * 16, 10 + u * 12, { fill: rgba("#6a6460", 0.45 * (1 - u)) });
        }),
        [0, 1, 2, 3, 4].map((k) => {
          const a = -Math.PI / 2 + (rnd(e.seed, k + 20) - 0.5) * 2.4, sp = 2 + rnd(e.seed, k + 30) * 2.5;
          return v.at({ translate: [e.x + Math.cos(a) * sp * age, e.y + Math.sin(a) * sp * age + age * age * 0.06], rotate: age * 0.2 + k }, v.rect(-4, -2.5, 8, 5, { fill: k % 2 === 0 ? INK : rgba(VERMILION, 0.9) }));
        }),
        u < 0.35 && v.circle(e.x, e.y, 14 + u * 60, { stroke: rgba(INK, 0.6 * (1 - u / 0.35)), weight: 3 }),
      ];
    }
    case "stamp": {
      const u = age / 50;
      return [
        v.rect(e.x - CW * 1.5 - u * 20, e.y - CH * 1.5 + 30 - u * 20, CW * 3 + u * 40, CH * 3 + u * 40, { stroke: rgba(VERMILION, 0.8 * (1 - u)), weight: 6 * (1 - u) + 1 }),
        [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
          const a = (k / 8) * Math.PI * 2, d = 30 + age * 3;
          return v.circle(e.x + Math.cos(a) * d, e.y + 20 + Math.sin(a) * d * 0.4, 6 * (1 - u), { fill: rgba("#b8a88a", 0.7 * (1 - u)) });
        }),
      ];
    }
    case "place": {
      const u = age / 30;
      return v.arc(e.x, e.y - 30, 20 + u * 30, -Math.PI * 0.2, Math.PI * 1.5 * u + 0.4, { stroke: rgba(INK, 0.55 * (1 - u)), weight: 5 * (1 - u) + 1, cap: "round" });
    }
    case "swipe": {
      const u = age / 18;
      return [0, 1, 2].map((k) => v.arc(e.x - 10, e.y - 16 + k * 10, 26, -0.9, -0.9 + 1.8 * clamp01(u * 2.5), { stroke: rgba(INK, 0.8 * (1 - u)), weight: 4, cap: "round" }));
    }
    case "crumple": {
      return [0, 1, 2, 3, 4, 5].map((k) => {
        const dx = (rnd(e.seed, k) - 0.5) * 50, dy = age * age * 0.05 - age * (1 + rnd(e.seed, k + 5));
        return v.at({ translate: [e.x + dx * age * 0.05, e.y + dy], rotate: age * 0.15 * (k % 2 === 0 ? 1 : -1) }, v.rect(-5, -4, 10, 8, { fill: k % 3 === 0 ? OCHRE : "#efe4c8", stroke: rgba(INK, 0.6), weight: 1 }));
      });
    }
    case "chomp": {
      const u = age / 14;
      return v.text("nom", { x: e.x - 6, y: e.y - 18 - u * 10 }, { overlay: true, size: 13, font: SERIF, style: "bold italic", fill: rgba(VERMILION, 1 - u * u), align: "center", valign: "middle" });
    }
    case "steam": {
      const u = age / 60;
      return [0, 1, 2].map((k) => v.circle(e.x - 34 - k * 6 - u * 10, e.y - 4 - u * 34 - k * 8, 5 + u * 8 + k * 2, { fill: rgba("#ffffff", 0.6 * (1 - u)) }));
    }
  }
}

// --- The cards and counters --------------------------------------------------------------

function cards(v: View, g: DeepReadonly<Game>): Drawing {
  return DEF_KINDS.map((kind, i) => {
    const info = DEFS[kind];
    const state: CardState = g.selected === kind ? "picked" : g.ink < info.cost ? "poor" : "ready";
    const pic = v.picture({ key: "card", width: CARD_W + 8, height: CARD_H + 8, deps: [kind, state] }, () =>
      paintCard(v, { seed: 900 + i, state, price: info.cost, label: info.short }, v.at({ translate: [CARD_W / 2 - 2, kind === "seal" ? 66 : 72], scale: kind === "crane" ? 0.5 : 0.56 }, v.at({ translate: [-FOOT_X, -FOOT_Y] }, paintDefender(v, kind, "idle", 0)))));
    const x = cardX(i);
    const cool = clamp01((g.ready[kind] - g.t) / info.cooldown);
    return [
      v.place(pic, x, CARD_Y - (state === "picked" ? 6 : 0)),
      cool > 0 && v.rect(x + 2, CARD_Y + 2, CARD_W - 4, (CARD_H - 4) * cool, { fill: "rgba(70,60,50,0.4)" }),
      v.text(String(i + 1), { x: x + 8, y: CARD_Y + 6 }, { size: 11, font: SERIF, fill: rgba(INK, 0.5) }),
    ];
  });
}

function counters(v: View, g: DeepReadonly<Game>): Drawing {
  const waveNo = Math.min(WAVE_COUNT, g.wave + 1);
  const left = g.queue.length + g.foes.length + WAVES.slice(g.wave + 1).reduce((s, w) => s + w.length, 0);
  return [
    v.text(String(g.ink), { x: 52, y: 112 }, { size: 24, font: SERIF, style: "bold", fill: INK, align: "center", valign: "middle", halo: "rgba(242,233,211,0.9)" }),
    v.text("ink", { x: 52, y: 134 }, { size: 12, font: SERIF, style: "italic", fill: INK, align: "center", valign: "middle" }),
    v.text(`Wave ${waveNo} of ${WAVE_COUNT}`, { x: 880, y: 116 }, { size: 18, font: SERIF, style: "bold", fill: INK, align: "right", valign: "middle", halo: "rgba(242,233,211,0.85)" }),
    v.text(WAVE_NAMES[g.wave] ?? "", { x: 880, y: 138 }, { size: 13, font: SERIF, style: "italic", fill: INK, align: "right", valign: "middle", halo: "rgba(242,233,211,0.85)" }),
    // A seal for each wave: filled once it is under way.
    v.place(v.picture({ key: "wave-seals", width: 130, height: 30, deps: [g.mode.type === "title" ? -1 : g.wave] }, () => Array.from({ length: WAVE_COUNT }, (_, i) => {
      const on = i <= g.wave && g.mode.type !== "title";
      return blob(v, [[4 + i * 30, 4], [26 + i * 30, 4], [26 + i * 30, 26], [4 + i * 30, 26]], { fill: on ? VERMILION : PAPER, seed: 950 + i, line: 1.6, lineColour: on ? VERMILION : INK, sharp: true, amp: 0.6 });
    })), 596, 100),
    v.text(`${TOTAL_FOES - left} / ${TOTAL_FOES} sent home`, { x: 611, y: 140 }, { size: 11, font: SERIF, style: "italic", fill: rgba(INK, 0.7), valign: "middle" }),
  ];
}

// --- Banners and the end ------------------------------------------------------------------

function ribbon(v: View, a: { w: number; y: number; opacity: number; title: string; sub?: string; size?: number }): Drawing {
  const pic = v.picture({ key: "ribbon", width: a.w, height: 60, deps: [a.w] }, () => paintRibbon(v, a.w, 970 + a.w));
  const x = Math.round(W / 2 - a.w / 2);
  if (a.opacity < 0.12) return null;
  return [
    v.place(pic, x, a.y - 30, { opacity: a.opacity * 0.92 }),
    v.text(a.title, { x: W / 2, y: a.y }, { overlay: true, size: a.size ?? 30, font: SERIF, style: "bold", fill: rgba(PAPER, a.opacity), align: "center", valign: "middle" }),
    a.sub !== undefined && v.text(a.sub, { x: W / 2, y: a.y + 44 }, { overlay: true, size: 17, font: SERIF, style: "italic", fill: rgba(INK, a.opacity), halo: rgba(PAPER, 0.9 * a.opacity), align: "center", valign: "middle" }),
  ];
}

function waveBanner(v: View, g: DeepReadonly<Game>): Drawing {
  if (g.mode.type !== "play") return null;
  const age = g.t - g.waveAt;
  if (g.nextWave !== null) {
    const left = Math.ceil((g.nextWave - g.t) / 60);
    return left <= 3 && v.text(`Next wave in ${left}…`, { x: W / 2, y: 300 }, { overlay: true, size: 22, font: SERIF, style: "italic", fill: INK, halo: rgba(PAPER, 0.9), align: "center", valign: "middle" });
  }
  if (age > 200) return null;
  const a = clamp01(age / 15) * clamp01((200 - age) / 30);
  const tip = g.wave === 0 && g.defenders.length === 0 ? "Click a card, then a square of the garden. Inkstones make more ink." : undefined;
  return ribbon(v, { w: 560, y: 290, opacity: a, title: `Wave ${g.wave + 1}: ${WAVE_NAMES[g.wave] ?? ""}`, size: 24, ...(tip === undefined ? {} : { sub: tip }) });
}

function button(v: View, label: string, hot: boolean): Drawing {
  const pic = v.picture({ key: "button", width: AGAIN.w + 10, height: AGAIN.h + 10, deps: [label, hot] }, () => [
    blob(v, [[5, 5], [AGAIN.w + 5, 5], [AGAIN.w + 5, AGAIN.h + 5], [5, AGAIN.h + 5]], { fill: hot ? "#e0563a" : VERMILION, seed: 990, line: 2.4, sharp: true, amp: 1.2 }),
    v.text(label, { x: AGAIN.w / 2 + 5, y: AGAIN.h / 2 + 5 }, { size: 20, font: SERIF, style: "bold", fill: "#fbf3e2", align: "center", valign: "middle" }),
  ]);
  return v.place(pic, AGAIN.x - 5, AGAIN.y - 5);
}

const over = (m: readonly [number, number] | null, b: { x: number; y: number; w: number; h: number }): boolean => m !== null && m[0] >= b.x && m[0] <= b.x + b.w && m[1] >= b.y && m[1] <= b.y + b.h;

function endScreen(v: View, s: Scene): Drawing {
  const g = s.game, m = g.mode;
  switch (m.type) {
    case "play": return null;
    case "title":
      return [
        v.rect(0, 0, W, H, { fill: rgba(PAPER, 0.45) }),
        ribbon(v, { w: 640, y: 250, opacity: 1, title: "Mochi Must Not Fall", size: 40 }),
        v.text("The umbrellas, sandals, lanterns and kettles have come alive, and they want the New Year mochi.", { x: W / 2 - 300, y: 300, w: 600 }, { overlay: true, size: 17, font: SERIF, style: "italic", fill: INK, halo: rgba(PAPER, 0.9), align: "center" }),
        v.text("Paint defenders with ink to keep the mochi safe and the cat asleep.", { x: W / 2 - 300, y: 346, w: 600 }, { overlay: true, size: 17, font: SERIF, style: "italic", fill: INK, halo: rgba(PAPER, 0.9), align: "center" }),
        button(v, "Begin", over(s.mouse, AGAIN)),
      ];
    case "won":
    case "lost": {
      const age = g.t - m.at, a = clamp01(age / 40);
          return [
        v.rect(0, 0, W, H, { fill: rgba(PAPER, 0.5 * a) }),
        ribbon(v, { w: 600, y: 250, opacity: a, title: m.type === "won" ? "The mochi is safe!" : `${m.by === "umbrella" ? "An" : "A"} ${FOES[m.by].short} got the mochi!`, size: 32, sub: m.type === "won" ? "Every last haunted thing has gone home. The cat sleeps on." : "And now the cat is awake, which is worse." }),
        age > 30 && button(v, "Paint again", over(s.mouse, AGAIN)),
      ];
    }
  }
}

// --- Hover ---

function hintWords(g: DeepReadonly<Game>, a: { mx: number; card: DefKind | null; drop: boolean; cell: { col: number; row: number } | null }): string | null {
  if (a.card !== null) return `${DEFS[a.card].name}, ${DEFS[a.card].cost} ink: ${DEFS[a.card].blurb}`;
  if (a.drop) return "a drop of ink: click to catch it";
  if (g.selected !== null || a.cell === null) return null;
  const row = a.cell.row;
  const f = g.foes.find((x) => x.row === row && Math.abs(x.x - a.mx) < 30);
  return f ? FOES[f.kind].name : null;
}

function hover(v: View, s: Scene, hints: boolean): Drawing {
  const g = s.game, m = s.mouse;
  if (g.mode.type !== "play") {
    v.cursor(over(m, AGAIN) && (g.mode.type === "title" || g.t - ("at" in g.mode ? g.mode.at : 0) > 30) ? "pointer" : "default");
    return null;
  }
  if (m === null) {
    v.cursor("default");
    return null;
  }
  const [mx, my] = m;
  const card = cardAt(mx, my);
  const drop = dropHit(g, mx, my);
  const cell = cellAt(mx, my);
  const sel = g.selected;
  const canPlace = sel !== null && cell !== null && (sel === "seal" || !occupied(g, cell.col, cell.row));
  v.cursor(card !== null || drop !== null || canPlace ? "pointer" : "default");
  const ghost = sel !== null && cell !== null && [
    v.rect(cellX(cell.col) + 3, cellY(cell.row) + 3, CW - 6, CH - 6, { fill: canPlace ? "rgba(255,250,230,0.35)" : "rgba(207,63,40,0.18)", stroke: canPlace ? rgba(INK, 0.6) : rgba(VERMILION, 0.8), weight: 2, dash: [6, 4] }),
    canPlace && v.place(defPic(v, sel, "idle", 0), cellX(cell.col) + CW / 2 - FOOT_X, rowFeet(cell.row) - FOOT_Y, { opacity: 0.45 }),
    sel === "seal" && v.rect(cellX(cell.col) - CW, cellY(cell.row) - CH, CW * 3, CH * 3, { stroke: rgba(VERMILION, 0.6), weight: 2, dash: [4, 6] }),
  ];
  const words = hints ? hintWords(g, { mx, card, drop: drop !== null, cell }) : null;
  return [ghost, words !== null && v.text(words, card === null ? { x: mx + 16, y: my + 18 } : { x: mx - 20, y: CARD_Y + CARD_H + 10 }, HINT)];
}

// --- The whole frame ----------------------------------------------------------------------

export function paintScene(v: View, s: Scene, o: { hints: boolean }): RootDrawing {
  const g = s.game;
  const board = v.picture({ key: "board", width: W, height: H }, () => v.paper({ scale: 3, contrast: 0.6 }, v.group({ effects: { paper: 0.35 } }, paintBoard(v))));
  const roller = v.picture({ key: "roller", width: W, height: H }, () => paintRoller(v));
  const drop = v.picture({ key: "drop", width: 40, height: 44 }, () => paintDrop(v));
  const since = s.frame - s.shake.at;
  const k = s.shake.amp * clamp01(1 - since / 22);
  const shake: [number, number] = k > 0.5 ? [Math.round(Math.sin(s.frame * 1.9) * k), Math.round(Math.cos(s.frame * 2.7) * k * 0.6)] : [0, 0];
  const lost = g.mode.type === "lost";
  const dusk = clamp01((g.wave - 1.5) / 1.5) * (g.mode.type === "title" ? 0 : 1);
  return [
    v.at({ translate: shake }, [
      v.place(board, 0, 0),
      v.place(v.picture({ key: "mochi", width: 100, height: 110, deps: [lost] }, () => v.at({ translate: [50, 100] }, paintMochi(v, lost))), MOCHI_AT[0] - 50, MOCHI_AT[1] - 100),
      v.place(v.picture({ key: "cat", width: 120, height: 80, deps: [lost] }, () => v.at({ translate: [60, 70] }, paintCat(v, lost))), CAT_AT[0] - 60, CAT_AT[1] - 70),
      !lost && g.mode.type !== "won" && [0, 1, 2].map((i) => {
        const ph = ((s.frame + i * 40) % 120) / 120;
        return v.text("z", { x: CAT_AT[0] - 30 + ph * 14 + i * 2, y: CAT_AT[1] - 44 - ph * 30 }, { overlay: true, size: 10 + ph * 8, font: SERIF, style: "italic", fill: rgba(INK, 0.7 * Math.sin(ph * Math.PI)), align: "center", valign: "middle" });
      }),
      stains(v, g),
      lanesDrawing(v, g),
      v.place(roller, 0, 0),
      dusk > 0 && v.rect(0, 0, W, H, { fill: rgba("#d8a070", 0.3 * dusk), blend: "multiply" }),
      g.fx.filter((e) => g.t - e.at < FX_LIFE[e.kind]).map((e) => fx(v, e, g.t)),
    ]),
    g.drops.map((d) => {
      const p = dropAt(d, g.t);
      return v.place(drop, Math.round(p.x - 20), Math.round(p.y - 40));
    }),
    cards(v, g),
    counters(v, g),
    waveBanner(v, g),
    hover(v, s, o.hints),
    endScreen(v, s),
  ];
}

