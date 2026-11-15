// Structural keys for plain data (draft section 6: what a renderer may keep).
// The recorder keys each shape's geometry and each brushed stroke's brush and
// gesture as it records them; the renderer keys what it keeps by these. A key
// is two independent 32-bit hashes over the exact bits of every number, so
// equal data gives equal keys and a collision needs both lanes to collide
// (about one in 2^64 per pair). Keys are memoised by object identity, so a
// picture's nodes, kept across frames, are hashed once.

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

// The two lanes, as module state: hashing is synchronous and not re-entrant, and
// plain variables keep the per-word cost to a few integer operations.
let laneA = 0;
let laneB = 0;

function word(w: number): void {
  laneA = Math.imul(laneA ^ w, 0x01000193);
  let b = Math.imul(laneB ^ w, 0x5bd1e995);
  b ^= b >>> 15;
  laneB = Math.imul(b, 0x27d4eb2d);
}

function num(x: number): void {
  f64[0] = x;
  word(u32[0] ?? 0);
  word(u32[1] ?? 0);
}

function str(s: string): void {
  word(s.length);
  for (let i = 0; i < s.length; i++) word(s.codePointAt(i) ?? 0);
}

function value(v: unknown): void {
  if (typeof v === "number") {
    word(1);
    num(v);
  } else if (typeof v === "string") {
    word(2);
    str(v);
  } else if (typeof v === "boolean") word(v ? 3 : 4);
  else if (v === undefined) word(5);
  else if (v === null) word(6);
  else if (Array.isArray(v)) {
    word(7);
    word(v.length);
    // Numbers inline (the same words `value` gives them): geometry is mostly long runs of numbers.
    for (const x of v) {
      if (typeof x === "number") {
        word(1);
        num(x);
      } else value(x);
    }
  } else if (typeof v === "object") {
    word(8);
    const keys = Object.keys(v);
    word(keys.length);
    for (const k of keys) {
      str(k);
      value(Reflect.get(v, k));
    }
  } else str(`?${typeof v}`);
}

function fin(h: number): number {
  let x = h ^ (h >>> 16);
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

const memo = new WeakMap<object, string>();

/** The structural key of plain data `v` (numbers by their exact bits; object keys in order), memoised by identity. */
export function keyOf(v: object): string {
  const hit = memo.get(v);
  if (hit !== undefined) return hit;
  laneA = 0x811c9dc5;
  laneB = 0x9747b28c;
  value(v);
  const key = `${fin(laneA).toString(36)}.${fin(laneB).toString(36)}`;
  memo.set(v, key);
  return key;
}

/** A transform's linear part as a key: its four numbers, exactly. */
export function linearKey(m: readonly number[]): string {
  return `${m[0] ?? 0},${m[1] ?? 0},${m[2] ?? 0},${m[3] ?? 0}`;
}
