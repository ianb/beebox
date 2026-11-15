// Structural keys for plain data (draft section 6: what a renderer may keep).
// The renderer keys what it keeps (shape geometry, brush expansions) by these,
// and computes each key when a cache first asks for it, not while recording. A
// key is two independent 32-bit hashes over the exact bits of every number, so
// equal data gives equal keys and a collision needs both lanes to collide
// (about one in 2^64 per pair). Keys are memoised by object identity, so a
// picture's nodes, kept across frames, are hashed once. Keys live only in this
// process: strings are hashed by an id given on first sight.
import type { Gesture } from "../core/brush/types.js";
import type { Geom } from "./nodes.js";

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

// The two lanes, as module state: plain variables keep the per-word cost to a
// few integer operations. A getter in the data can call `keyOf` again, so
// `keyOf` saves and restores the lanes around its own hash.
let laneA = 0;
let laneB = 0;

function word(w: number): void {
  laneA = Math.imul(laneA ^ w, 0x01000193);
  let b = Math.imul(laneB ^ w, 0x5bd1e995);
  b ^= b >>> 15;
  laneB = Math.imul(b, 0x27d4eb2d);
}

/** A number's two words, untagged: callers tag it, or its place in a fixed layout says it is a number. */
function bits(x: number): void {
  f64[0] = x;
  word(u32[0] ?? 0);
  word(u32[1] ?? 0);
}

// Short strings (object keys, path command names, preset names) get an id on
// first sight; a long string, or any once the table is full, is hashed by its
// characters under its own tag.
const ids = new Map<string, number>();
const MAX_ID_LENGTH = 32;
const MAX_IDS = 4096;

/** `s`'s id, given on first sight; undefined for a long string, or once the table is full. */
function idOf(s: string): number | undefined {
  let id = ids.get(s);
  if (id === undefined && s.length <= MAX_ID_LENGTH && ids.size < MAX_IDS) {
    id = ids.size;
    ids.set(s, id);
  }
  return id;
}

function str(s: string): void {
  const id = idOf(s);
  if (id !== undefined) {
    word(2);
    word(id);
    return;
  }
  word(9);
  word(s.length);
  for (let i = 0; i < s.length; i++) word(s.codePointAt(i) ?? 0);
}

/** An array: its length, then per run of 32 elements a mask of which are numbers; numbers untagged, others as values. */
function array(v: readonly unknown[]): void {
  word(7);
  const n = v.length;
  word(n);
  for (let s = 0; s < n; s += 32) {
    const e = Math.min(n, s + 32);
    let mask = 0;
    for (let i = s; i < e; i++) if (typeof v[i] === "number") mask |= 1 << (i - s);
    word(mask);
    for (let i = s; i < e; i++) {
      const x = v[i];
      if (typeof x === "number") bits(x);
      else value(x);
    }
  }
}

function value(v: unknown): void {
  if (typeof v === "number") {
    word(1);
    bits(v);
  } else if (typeof v === "string") str(v);
  else if (typeof v === "boolean") word(v ? 3 : 4);
  else if (v === undefined) word(5);
  else if (v === null) word(6);
  else if (Array.isArray(v)) array(v);
  else if (typeof v === "object") {
    word(8);
    const keys = Object.keys(v);
    word(keys.length);
    for (const k of keys) {
      str(k);
      value(Reflect.get(v, k));
    }
  } else str(`?${typeof v}`);
}

// A geometry's layout is written as doubles into one scratch buffer, then its words are hashed in one tight loop.
let scratch = new Float64Array(1024);
let scratchWords = new Uint32Array(scratch.buffer);
let used = 0;

function put(x: number): void {
  if (used === scratch.length) {
    const grown = new Float64Array(scratch.length * 2);
    grown.set(scratch);
    scratch = grown;
    scratchWords = new Uint32Array(scratch.buffer);
  }
  scratch[used++] = x;
}

/** A path command's name as a number, or -1 for a name outside the layout. */
function commandCode(name: unknown): number {
  switch (name) {
    case "move":
      return 1;
    case "line":
      return 2;
    case "quad":
      return 3;
    case "bezier":
      return 4;
    case "close":
      return 5;
    default:
      return -1;
  }
}

/** Write `g` in its kind's layout into the scratch buffer; false when it does not fit the layout. */
function layout(g: Geom): boolean {
  switch (g.kind) {
    case "rect":
      for (const x of [101, g.x, g.y, g.w, g.h]) put(x);
      return true;
    case "ellipse":
      for (const x of [102, g.x, g.y, g.rx, g.ry]) put(x);
      return true;
    case "arc":
      for (const x of [103, g.x, g.y, g.r, g.start, g.end]) put(x);
      return true;
    case "poly":
      put(104);
      put(g.closed ? 1 : 0);
      put(g.points.length);
      for (const p of g.points) {
        // A hand-built scene can hold a point that is not a pair; the recorder refuses one at the call.
        const q: readonly unknown[] = p;
        if (!(q.length === 2 && typeof p[0] === "number" && typeof p[1] === "number")) return false;
        put(p[0]);
        put(p[1]);
      }
      return true;
    case "path":
      put(105);
      put(g.commands.length);
      for (const c of g.commands) {
        const code = commandCode(c[0]);
        if (code < 0) return false;
        put(code);
        put(c.length);
        for (let i = 1; i < c.length; i++) {
          const x = c[i];
          if (typeof x !== "number") return false;
          put(x);
        }
      }
      return true;
    default:
      return false;
  }
}

/**
 * A geometry in a fixed layout per kind (its kind's number, then its numbers; a path command's name as a number and
 * its length, then its numbers), hashed word by word. Anything outside the layout (a point that is not a pair, a
 * command that is not a path command of numbers) is hashed as plain data under its own word.
 */
function geom(g: Geom): void {
  laid(g, { layout, fallback: 100 });
}

/** A gesture in its layout (`gestureLayout`), or as plain data under its own word. */
function gesture(g: Gesture): void {
  laid(g, { layout: gestureLayout, fallback: 200 });
}

/** An envelope in the layout: a number, a preset name by its id, or keyframe pairs; false when it does not fit. */
function putEnvelope(env: unknown): boolean {
  if (env === undefined) put(0);
  else if (typeof env === "number") {
    put(1);
    put(env);
  } else if (typeof env === "string") {
    const id = idOf(env);
    if (id === undefined) return false;
    put(2);
    put(id);
  } else if (Array.isArray(env)) {
    put(3);
    put(env.length);
    for (const k of env) {
      const pair: unknown = k;
      if (!(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "number" && typeof pair[1] === "number")) return false;
      put(pair[0]);
      put(pair[1]);
    }
  } else return false;
  return true;
}

const GESTURE_FIELDS = new Set(["pressure", "wobble", "seed", "faint"]);

/** A gesture in a fixed layout (its four fields in one order, an absent or undefined field as 0); false when it does not fit. */
function gestureLayout(g: Gesture): boolean {
  for (const k of Object.keys(g)) if (!GESTURE_FIELDS.has(k)) return false;
  put(201);
  if (!putEnvelope(g.pressure)) return false;
  for (const x of [g.wobble, g.seed]) {
    if (x === undefined) put(0);
    else if (typeof x === "number") {
      put(1);
      put(x);
    } else return false;
  }
  const faint: unknown = g.faint;
  if (faint !== undefined && typeof faint !== "boolean") return false;
  put(faint === undefined ? 0 : faint ? 1 : 2);
  return true;
}

/** Hash the scratch buffer's words written by a layout, or `v` as plain data under `fallback` when it did not fit. */
function laid<T>(v: T, a: { layout: (v: T) => boolean; fallback: number }): void {
  used = 0;
  if (!a.layout(v)) {
    word(a.fallback);
    value(v);
    return;
  }
  const words = scratchWords;
  const n = used * 2;
  let la = laneA;
  let lb = laneB;
  for (let i = 0; i < n; i++) {
    const w = words[i] ?? 0;
    la = Math.imul(la ^ w, 0x01000193);
    lb = Math.imul(lb ^ w, 0x5bd1e995);
    lb ^= lb >>> 15;
    lb = Math.imul(lb, 0x27d4eb2d);
  }
  laneA = la;
  laneB = lb;
}

function fin(h: number): number {
  let x = h ^ (h >>> 16);
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

const plainKeys = new WeakMap<object, string>();
const geomKeys = new WeakMap<object, string>();
const gestureKeys = new WeakMap<object, string>();

/** Hash `v` with `walk` on fresh lanes, the outer hash's lanes kept, memoised by identity in `memo`. */
function keyed<T extends object>(v: T, a: { walk: (v: T) => void; memo: WeakMap<object, string> }): string {
  const { walk, memo } = a;
  const hit = memo.get(v);
  if (hit !== undefined) return hit;
  const outerA = laneA, outerB = laneB;
  laneA = 0x811c9dc5;
  laneB = 0x9747b28c;
  walk(v);
  // Four UTF-16 code units, one per 16 bits of the lanes: a fixed width, so a key needs no separator where it is
  // joined into a cache key, and much cheaper to make than base-36 text. Keys are never shown.
  const ha = fin(laneA);
  const hb = fin(laneB);
  const key = String.fromCodePoint(ha & 0xffff, ha >>> 16, hb & 0xffff, hb >>> 16);
  laneA = outerA;
  laneB = outerB;
  memo.set(v, key);
  return key;
}

/** The structural key of plain data `v` (numbers by their exact bits; object keys in order), memoised by identity. */
export function keyOf(v: object): string {
  return keyed(v, { walk: value, memo: plainKeys });
}

/** The structural key of a shape's geometry: what the geometry cache and brush expansions keep it under. */
export function geomKey(g: Geom): string {
  return keyed(g, { walk: geom, memo: geomKeys });
}

/** The structural key of a brushed stroke's gesture: what brush expansions keep it under. */
export function gestureKey(g: Gesture): string {
  return keyed(g, { walk: gesture, memo: gestureKeys });
}

/** A transform's linear part as a key: its four numbers, exactly. */
export function linearKey(m: readonly number[]): string {
  return `${m[0] ?? 0},${m[1] ?? 0},${m[2] ?? 0},${m[3] ?? 0}`;
}
