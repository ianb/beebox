// Structural keys for plain data (draft section 6: what a renderer may keep).
// The recorder keys each shape's geometry and each brushed stroke's brush and
// gesture as it records them; the renderer keys what it keeps by these. A key
// is two independent 32-bit hashes over the exact bits of every number, so
// equal data gives equal keys and a collision needs both lanes to collide
// (about one in 2^64 per pair). Keys are memoised by object identity, so a
// picture's nodes, kept across frames, are hashed once.

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

class Hasher {
  #a = 0x811c9dc5;
  #b = 0x9747b28c;

  word(w: number): void {
    this.#a = Math.imul(this.#a ^ w, 0x01000193);
    let b = Math.imul(this.#b ^ w, 0x5bd1e995);
    b ^= b >>> 15;
    this.#b = Math.imul(b, 0x27d4eb2d);
  }

  num(x: number): void {
    f64[0] = x;
    this.word(u32[0] ?? 0);
    this.word(u32[1] ?? 0);
  }

  str(s: string): void {
    this.word(s.length);
    for (let i = 0; i < s.length; i++) this.word(s.codePointAt(i) ?? 0);
  }

  value(v: unknown): void {
    if (typeof v === "number") {
      this.word(1);
      this.num(v);
    } else if (typeof v === "string") {
      this.word(2);
      this.str(v);
    } else if (typeof v === "boolean") this.word(v ? 3 : 4);
    else if (v === undefined) this.word(5);
    else if (v === null) this.word(6);
    else if (Array.isArray(v)) {
      this.word(7);
      this.word(v.length);
      for (const x of v) this.value(x);
    } else if (typeof v === "object") {
      this.word(8);
      const keys = Object.keys(v);
      this.word(keys.length);
      for (const k of keys) {
        this.str(k);
        this.value(Reflect.get(v, k));
      }
    } else this.str(`?${typeof v}`);
  }

  done(): string {
    const fin = (h: number): number => {
      let x = h ^ (h >>> 16);
      x = Math.imul(x, 0x85ebca6b);
      x ^= x >>> 13;
      x = Math.imul(x, 0xc2b2ae35);
      return (x ^ (x >>> 16)) >>> 0;
    };
    return `${fin(this.#a).toString(36)}.${fin(this.#b).toString(36)}`;
  }
}

const memo = new WeakMap<object, string>();

/** The structural key of plain data `v` (numbers by their exact bits; object keys in order), memoised by identity. */
export function keyOf(v: object): string {
  const hit = memo.get(v);
  if (hit !== undefined) return hit;
  const h = new Hasher();
  h.value(v);
  const key = h.done();
  memo.set(v, key);
  return key;
}

/** A transform's linear part as a key: its four numbers, exactly. */
export function linearKey(m: readonly number[]): string {
  return `${m[0] ?? 0},${m[1] ?? 0},${m[2] ?? 0},${m[3] ?? 0}`;
}
