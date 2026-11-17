// The rules of Mochi Must Not Fall: the board, the painted defenders and the
// haunted household things, the waves, and one step of the game. Everything here
// is pure: `step` takes a game and returns the next one, with the sounds and
// shakes it caused. Game time `t` counts steps; at speed 2 a frame runs two.
import type { DeepReadonly } from "@ianbicking/canvas-loop";

export const W = 960;
export const H = 600;
export const COLS = 9;
export const ROWS = 5;
/** The grid's top-left corner and cell size. */
export const GX = 128;
export const GY = 166;
export const CW = 84;
export const CH = 84;
/** A foe whose x passes this has reached the mochi. */
export const MOCHI_X = 92;
/** Foes start here, behind the scroll's right roller. */
export const SPAWN_X = 930;

export type DefKind = "inkstone" | "crane" | "screen" | "tiger" | "seal";
export type FoeKind = "umbrella" | "sandal" | "kettle" | "lantern";
export const DEF_KINDS: readonly DefKind[] = ["inkstone", "crane", "screen", "tiger", "seal"];

export interface DefInfo {
  readonly name: string;
  /** The word on its card. */
  readonly short: string;
  readonly cost: number;
  readonly hp: number;
  /** Steps before the card can be used again. */
  readonly cooldown: number;
  readonly blurb: string;
}
export const DEFS: Record<DefKind, DefInfo> = {
  inkstone: { short: "Inkstone", name: "Inkstone", cost: 50, hp: 300, cooldown: 300, blurb: "wells up a drop of ink every fourteen seconds" },
  crane: { short: "Crane", name: "Crane", cost: 100, hp: 300, cooldown: 300, blurb: "flicks ink blots down its row" },
  screen: { short: "Screen", name: "Folding screen", cost: 50, hp: 2400, cooldown: 900, blurb: "a sturdy screen; takes ages to chew through" },
  tiger: { short: "Tiger", name: "Paper tiger", cost: 150, hp: 600, cooldown: 600, blurb: "swats anything that comes close" },
  seal: { short: "Seal", name: "Red seal", cost: 125, hp: 1, cooldown: 1200, blurb: "stamps flat everything in a 3-by-3 square" },
};

export interface FoeInfo {
  readonly name: string;
  readonly short: string;
  readonly hp: number;
  /** Pixels per step. */
  readonly speed: number;
  /** Damage per step while chewing a defender. */
  readonly bite: number;
  /** Floats over defenders instead of chewing them. */
  readonly floats: boolean;
}
export const FOES: Record<FoeKind, FoeInfo> = {
  umbrella: { short: "umbrella", name: "Hopping umbrella", hp: 150, speed: 0.3, bite: 1, floats: false },
  sandal: { short: "sandal", name: "Runaway sandal", hp: 60, speed: 0.62, bite: 0.7, floats: false },
  kettle: { short: "kettle", name: "Iron kettle", hp: 640, speed: 0.17, bite: 1.6, floats: false },
  lantern: { short: "lantern", name: "Lantern ghost", hp: 180, speed: 0.36, bite: 0, floats: true },
};

export const SHOT_SPEED = 7;
export const SHOT_DAMAGE = 20;
export const DROP_INK = 25;
export const START_INK = 150;
const CRANE_EVERY = 84;
const TIGER_EVERY = 72;
const TIGER_DAMAGE = 70;
export const INKSTONE_EVERY = 840;
export const SEAL_FALL = 36;
const SEAL_DAMAGE = 900;
const SKY_EVERY = 560;
/** A drop nobody clicks flows to the inkwell on its own after this long. */
export const DROP_WAIT = 320;
export const DROP_FLY = 36;
/** Steps between the last foe of a wave and the next wave's banner. */
const BREAK = 300;

export interface Defender { readonly id: number; readonly kind: DefKind; readonly col: number; readonly row: number; readonly hp: number; readonly at: number; readonly last: number; readonly hitAt: number }
export interface Foe { readonly id: number; readonly kind: FoeKind; readonly row: number; readonly x: number; readonly hp: number; readonly born: number; readonly hitAt: number; readonly eating: boolean; readonly knock: number; readonly seed: number }
export interface Shot { readonly id: number; readonly row: number; readonly x: number; readonly born: number }
/** A drop of ink: it rises (from an inkstone) or falls (from the sky) to rest at (x, y1). */
export interface Drop { readonly id: number; readonly x: number; readonly y0: number; readonly y1: number; readonly born: number; readonly got: number | null }
export type FxKind = "splat" | "poof" | "stamp" | "place" | "swipe" | "crumple" | "chomp" | "steam";
export interface Fx { readonly kind: FxKind; readonly x: number; readonly y: number; readonly at: number; readonly seed: number }
export interface Stain { readonly x: number; readonly y: number; readonly at: number; readonly seed: number; readonly red: boolean }
export interface Spawn { readonly at: number; readonly kind: FoeKind; readonly row: number }

export type Mode =
  | { readonly type: "title" }
  | { readonly type: "play" }
  | { readonly type: "won"; readonly at: number }
  | { readonly type: "lost"; readonly at: number; readonly by: FoeKind; readonly row: number };

export interface Game {
  readonly t: number;
  readonly mode: Mode;
  readonly ink: number;
  readonly selected: DefKind | null;
  /** The step at which each card can be used again. */
  readonly ready: Readonly<Record<DefKind, number>>;
  readonly defenders: readonly Defender[];
  readonly foes: readonly Foe[];
  readonly shots: readonly Shot[];
  readonly drops: readonly Drop[];
  readonly fx: readonly Fx[];
  readonly stains: readonly Stain[];
  /** The wave under way (0-based), when it began, and the foes still to come. */
  readonly wave: number;
  readonly waveAt: number;
  readonly queue: readonly Spawn[];
  /** When the next wave begins, during a break between waves. */
  readonly nextWave: number | null;
  readonly defeated: number;
  readonly nextId: number;
  readonly rng: number;
}

/** What a step did that the player should hear or feel. */
export type Cue =
  | { readonly kind: "shot" } | { readonly kind: "hit"; readonly foe: FoeKind } | { readonly kind: "defeat"; readonly foe: FoeKind; readonly n: number }
  | { readonly kind: "swipe" } | { readonly kind: "stamp" } | { readonly kind: "chomp" } | { readonly kind: "eaten"; readonly def: DefKind }
  | { readonly kind: "drop" } | { readonly kind: "wave"; readonly wave: number } | { readonly kind: "won" } | { readonly kind: "lost" } | { readonly kind: "arrive"; readonly foe: FoeKind };

// --- Waves -------------------------------------------------------------------------

export const WAVE_NAMES: readonly string[] = [
  "The umbrellas are restless",
  "Sandals, running loose",
  "Lanterns drift, kettles boil",
  "Everything in the cupboard",
];

function hash(a: number, b: number, salt = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(salt | 0, 2147483587);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function waveOf(n: number): Spawn[] {
  const out: Spawn[] = [];
  /** `count` foes of one kind, `gap` steps apart from `from`; `pair` sends each with a twin just behind. */
  const run = (a: { kind: FoeKind; count: number; from: number; gap: number; salt: number; pair?: boolean }): void => {
    for (let k = 0; k < a.count; k++) {
      const row = Math.floor(hash(n, a.salt + k, 7) * ROWS);
      out.push({ at: a.from + k * a.gap, kind: a.kind, row });
      if (a.pair === true) out.push({ at: a.from + k * a.gap + 40, kind: a.kind, row });
    }
  };
  switch (n) {
    case 0:
      run({ kind: "umbrella", count: 6, from: 1200, gap: 520, salt: 0 });
      break;
    case 1:
      run({ kind: "umbrella", count: 7, from: 120, gap: 420, salt: 0 });
      run({ kind: "sandal", count: 3, from: 700, gap: 900, salt: 20, pair: true });
      break;
    case 2:
      run({ kind: "umbrella", count: 8, from: 120, gap: 360, salt: 0 });
      run({ kind: "kettle", count: 3, from: 600, gap: 1000, salt: 30 });
      run({ kind: "lantern", count: 4, from: 400, gap: 700, salt: 40 });
      run({ kind: "sandal", count: 2, from: 1600, gap: 500, salt: 50 });
      break;
    default: {
      run({ kind: "umbrella", count: 10, from: 120, gap: 260, salt: 0 });
      run({ kind: "kettle", count: 5, from: 500, gap: 520, salt: 30 });
      run({ kind: "lantern", count: 5, from: 300, gap: 480, salt: 40 });
      run({ kind: "sandal", count: 6, from: 900, gap: 300, salt: 50 });
      // The finale: one of each, all at once, in a line down the board.
      const finale: readonly FoeKind[] = ["umbrella", "kettle", "lantern", "sandal", "umbrella"];
      for (const [r, kind] of finale.entries()) out.push({ at: 3100 + r * 20, kind, row: r });
    }
  }
  return out.toSorted((a, b) => a.at - b.at);
}
export const WAVES: readonly (readonly Spawn[])[] = [0, 1, 2, 3].map(waveOf);
export const WAVE_COUNT = WAVES.length;
export const TOTAL_FOES = WAVES.reduce((s, w) => s + w.length, 0);

// --- Geometry ----------------------------------------------------------------------

export const cellX = (col: number): number => GX + col * CW;
export const cellY = (row: number): number => GY + row * CH;
/** The ground line of a row: where feet stand. */
export const rowFeet = (row: number): number => GY + row * CH + CH - 12;
export const defCentre = (d: { col: number }): number => cellX(d.col) + CW / 2;

export function cellAt(x: number, y: number): { col: number; row: number } | null {
  const col = Math.floor((x - GX) / CW), row = Math.floor((y - GY) / CH);
  return col >= 0 && col < COLS && row >= 0 && row < ROWS ? { col, row } : null;
}

/** Where a drop is at step t: rising or falling with a little bounce, waiting, then flying to the inkwell. */
export function dropAt(d: DeepReadonly<Drop>, t: number): { x: number; y: number; scale: number } {
  if (d.got !== null) {
    const u = Math.min(1, (t - d.got) / DROP_FLY);
    const e = u * u * (3 - 2 * u);
    const from = dropRest(d, d.got);
    return { x: from.x + (INKWELL[0] - from.x) * e, y: from.y + (INKWELL[1] - from.y) * e - Math.sin(Math.PI * u) * 60, scale: 1 - 0.5 * u };
  }
  return dropRest(d, t);
}
function dropRest(d: DeepReadonly<Drop>, t: number): { x: number; y: number; scale: number } {
  const age = t - d.born;
  const fall = d.y0 < d.y1;
  const dur = fall ? 150 : 40;
  const u = Math.min(1, age / dur);
  const y = fall ? d.y0 + (d.y1 - d.y0) * u : d.y1 + (d.y0 - d.y1) * (1 - u) - Math.sin(Math.PI * u) * 34;
  const settle = age > dur ? Math.abs(Math.sin((age - dur) * 0.25)) * Math.max(0, 6 - (age - dur) * 0.25) : 0;
  return { x: d.x, y: y - settle + Math.sin(age * 0.06) * (age > dur + 30 ? 2 : 0), scale: 1 };
}
/** Where collected ink flies to: the inkwell in the corner. */
export const INKWELL: readonly [number, number] = [52, 62];

// --- Cards --------------------------------------------------------------------------

export const CARD_X = 112;
export const CARD_Y = 14;
export const CARD_W = 74;
export const CARD_H = 112;
export const CARD_GAP = 10;
export const cardX = (i: number): number => CARD_X + i * (CARD_W + CARD_GAP);
export function cardAt(x: number, y: number): DefKind | null {
  if (y < CARD_Y || y > CARD_Y + CARD_H) return null;
  return DEF_KINDS.find((_, i) => x >= cardX(i) && x <= cardX(i) + CARD_W) ?? null;
}

/** The restart button on the win and lose screens. */
export const AGAIN = { x: W / 2 - 90, y: 388, w: 180, h: 50 } as const;

// --- The game -------------------------------------------------------------------------

export function newGame(mode: Mode): Game {
  return {
    t: 0, mode, ink: START_INK, selected: null,
    ready: { inkstone: 0, crane: 0, screen: 0, tiger: 0, seal: 0 },
    defenders: [], foes: [], shots: [], drops: [], fx: [], stains: [],
    wave: 0, waveAt: 0, queue: WAVES[0] ?? [], nextWave: null, defeated: 0, nextId: 1, rng: 1,
  };
}

export const occupied = (g: DeepReadonly<Game>, col: number, row: number): boolean => g.defenders.some((d) => d.col === col && d.row === row && d.kind !== "seal");

export type PlaceResult = { readonly ok: true; readonly game: Game } | { readonly ok: false; readonly why: "cost" | "busy" | "cooling" };

export function place(g: DeepReadonly<Game>, kind: DefKind, col: number, row: number): PlaceResult {
  const info = DEFS[kind];
  if (g.ink < info.cost) return { ok: false, why: "cost" };
  if (g.t < g.ready[kind]) return { ok: false, why: "cooling" };
  if (kind !== "seal" && occupied(g, col, row)) return { ok: false, why: "busy" };
  const d: Defender = { id: g.nextId, kind, col, row, hp: info.hp, at: g.t, last: g.t, hitAt: -999 };
  return {
    ok: true,
    game: {
      ...g, ink: g.ink - info.cost, selected: null, nextId: g.nextId + 1,
      ready: { ...g.ready, [kind]: g.t + info.cooldown },
      defenders: [...g.defenders, d],
      fx: [...g.fx, { kind: "place", x: defCentre(d), y: rowFeet(row), at: g.t, seed: d.id }],
    },
  };
}

/** The drop under (x, y), if any, at step t. */
export function dropHit(g: DeepReadonly<Game>, x: number, y: number): DeepReadonly<Drop> | null {
  return g.drops.find((d) => {
    if (d.got !== null) return false;
    const p = dropAt(d, g.t);
    return Math.hypot(x - p.x, y - (p.y - 12)) < 26;
  }) ?? null;
}

export function collect(g: DeepReadonly<Game>, id: number): Game {
  return { ...g, drops: g.drops.map((d) => (d.id === id ? { ...d, got: g.t } : d)) };
}

/** A working copy whose fields `step` changes before it returns the new game. */
type Live<T> = { -readonly [K in keyof T]: T[K] };

export const FX_LIFE: Record<FxKind, number> = { splat: 22, poof: 46, stamp: 50, place: 30, swipe: 18, crumple: 40, chomp: 14, steam: 60 };
const STAIN_LIFE = 900;

/** A foe's front edge, where it chews. */
const front = (f: DeepReadonly<Foe>): number => f.x - 18;

// eslint-disable-next-line complexity -- one game step: spawns, waves, each kind of defender, shots, foes, drops; each part is a few lines
export function step(g0: DeepReadonly<Game>): { game: Game; cues: Cue[]; shake: number } {
  const cues: Cue[] = [];
  let shake = 0;
  if (g0.mode.type !== "play") return { game: { ...g0, t: g0.t + 1, fx: g0.fx.filter((e) => g0.t + 1 - e.at < FX_LIFE[e.kind]) }, cues, shake };
  const t = g0.t + 1;
  let nextId = g0.nextId;
  let rng = g0.rng;
  const rand = (): number => hash(rng++, 99, 5);
  const fx: Fx[] = g0.fx.filter((e) => t - e.at < FX_LIFE[e.kind]);
  const stains: Stain[] = g0.stains.filter((s) => t - s.at < STAIN_LIFE);
  let ink = g0.ink;
  let defeated = g0.defeated;

  // Spawns and waves.
  let { wave, waveAt, nextWave } = g0;
  let queue = g0.queue;
  const foes: Live<Foe>[] = g0.foes.map((f) => ({ ...f }));
  while (queue.length > 0 && (queue[0]?.at ?? 0) <= t - waveAt) {
    const s = queue[0];
    if (s) {
      foes.push({ id: nextId++, kind: s.kind, row: s.row, x: SPAWN_X + rand() * 20, hp: FOES[s.kind].hp, born: t, hitAt: -999, eating: false, knock: 0, seed: Math.floor(rand() * 1000) });
      cues.push({ kind: "arrive", foe: s.kind });
    }
    queue = queue.slice(1);
  }
  if (nextWave !== null && t >= nextWave) {
    wave += 1;
    waveAt = t;
    queue = WAVES[wave] ?? [];
    nextWave = null;
    cues.push({ kind: "wave", wave });
  }
  if (wave === 0 && t === 1) cues.push({ kind: "wave", wave: 0 });

  // Ink falls from the sky now and then.
  const drops: Drop[] = g0.drops.filter((d) => d.got === null || t - d.got < DROP_FLY);
  if (t % SKY_EVERY === 300) {
    const col = Math.floor(rand() * COLS), row = Math.floor(rand() * ROWS);
    drops.push({ id: nextId++, x: cellX(col) + CW / 2, y0: GY - 40, y1: rowFeet(row) - 14, born: t, got: null });
  }
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    if (d && d.got === null && t - d.born > DROP_WAIT) drops[i] = { ...d, got: t };
  }
  for (const d of drops) if (d.got === t || (d.got !== null && t - d.got === DROP_FLY - 1)) {
    if (t - d.got === DROP_FLY - 1) ink += DROP_INK;
  }

  // Defenders act.
  const shots: Live<Shot>[] = g0.shots.map((s) => ({ ...s }));
  const defenders: Live<Defender>[] = [];
  const hurt = (f: Live<Foe>, dmg: number, knock: number): void => {
    f.hp -= dmg;
    f.hitAt = t;
    f.knock = Math.max(f.knock, knock);
  };
  for (const d0 of g0.defenders) {
    const d: Live<Defender> = { ...d0 };
    const cx = defCentre(d);
    const inRow = foes.filter((f) => f.row === d.row && f.hp > 0);
    switch (d.kind) {
      case "inkstone":
        if (t - d.last >= (d.last === d.at ? 300 : INKSTONE_EVERY)) {
          drops.push({ id: nextId++, x: cx + (rand() - 0.5) * 24, y0: rowFeet(d.row) - 30, y1: rowFeet(d.row) - 30, born: t, got: null });
          d.last = t;
          cues.push({ kind: "drop" });
        }
        break;
      case "crane":
        if (t - d.last >= CRANE_EVERY && inRow.some((f) => f.x > cx - 10 && f.x < W - 40)) {
          shots.push({ id: nextId++, row: d.row, x: cx + 26, born: t });
          d.last = t;
          cues.push({ kind: "shot" });
        }
        break;
      case "tiger": {
        const near = inRow.filter((f) => f.x > cx - 30 && f.x < cx + CW * 1.35);
        if (t - d.last >= TIGER_EVERY && near.length > 0) {
          for (const f of near) hurt(f, TIGER_DAMAGE, 14);
          d.last = t;
          fx.push({ kind: "swipe", x: cx + 40, y: rowFeet(d.row) - 30, at: t, seed: d.id + t });
          cues.push({ kind: "swipe" });
        }
        break;
      }
      case "seal":
        if (t - d.at === SEAL_FALL) {
          for (const f of foes) if (Math.abs(f.row - d.row) <= 1 && Math.abs(f.x - cx) < CW * 1.5) hurt(f, SEAL_DAMAGE, 0);
          fx.push({ kind: "stamp", x: cx, y: rowFeet(d.row) - 30, at: t, seed: d.id });
          stains.push({ x: cx, y: rowFeet(d.row) - 34, at: t, seed: d.id, red: true });
          cues.push({ kind: "stamp" });
          shake = Math.max(shake, 12);
        }
        if (t - d.at > SEAL_FALL + 24) continue;
        break;
      case "screen":
        break;
    }
    defenders.push(d);
  }

  // Shots fly and splash.
  const flying: Shot[] = [];
  for (const s of shots) {
    s.x += SHOT_SPEED;
    const target = foes.filter((f) => f.row === s.row && f.hp > 0 && Math.abs(f.x - s.x) < 22 && f.x < W - 30).toSorted((a, b) => a.x - b.x)[0];
    if (target) {
      hurt(target, SHOT_DAMAGE, 3);
      fx.push({ kind: "splat", x: s.x, y: rowFeet(s.row) - 32, at: t, seed: s.id });
      cues.push({ kind: "hit", foe: target.kind });
    } else if (s.x < W - 20) flying.push(s);
  }

  // Foes walk, chew, and fall.
  const alive: Live<Foe>[] = [];
  let lost: Mode | null = null;
  for (const f of foes) {
    if (f.hp <= 0) {
      defeated += 1;
      fx.push({ kind: "poof", x: f.x, y: rowFeet(f.row) - 28, at: t, seed: f.id });
      stains.push({ x: f.x, y: rowFeet(f.row) - 6, at: t, seed: f.id, red: false });
      cues.push({ kind: "defeat", foe: f.kind, n: defeated });
      continue;
    }
    const info = FOES[f.kind];
    const victim = info.floats ? undefined : defenders.find((d) => d.row === f.row && d.kind !== "seal" && front(f) < defCentre(d) + 30 && front(f) > defCentre(d) - 24);
    if (victim) {
      victim.hp -= info.bite;
      victim.hitAt = t;
      if (!f.eating || (t - f.born) % 40 === 0) {
        cues.push({ kind: "chomp" });
        fx.push({ kind: "chomp", x: front(f), y: rowFeet(f.row) - 30, at: t, seed: f.id + t });
      }
      f.eating = true;
    } else {
      f.eating = false;
      f.x -= info.speed;
    }
    if (f.knock > 0.2) {
      f.x += f.knock * 0.4;
      f.knock *= 0.7;
    } else f.knock = 0;
    if (f.kind === "kettle" && (t + f.seed) % 90 === 0) fx.push({ kind: "steam", x: f.x - 6, y: rowFeet(f.row) - 64, at: t, seed: f.id + t });
    if (f.x < MOCHI_X && lost === null) lost = { type: "lost", at: t, by: f.kind, row: f.row };
    alive.push(f);
  }

  // Defenders chewed to nothing.
  const standing = defenders.filter((d) => {
    if (d.hp > 0) return true;
    fx.push({ kind: "crumple", x: defCentre(d), y: rowFeet(d.row) - 30, at: t, seed: d.id });
    cues.push({ kind: "eaten", def: d.kind });
    return false;
  });

  let mode: Mode = g0.mode;
  if (lost !== null) {
    mode = lost;
    cues.push({ kind: "lost" });
    shake = Math.max(shake, 16);
  } else if (queue.length === 0 && alive.length === 0 && nextWave === null) {
    if (wave >= WAVE_COUNT - 1) {
      mode = { type: "won", at: t };
      cues.push({ kind: "won" });
    } else nextWave = t + BREAK;
  }

  return {
    game: { ...g0, t, mode, ink, defenders: standing, foes: alive, shots: flying, drops, fx, stains: stains.slice(-24), wave, waveAt, queue, nextWave, defeated, nextId, rng },
    cues, shake,
  };
}
