// Picture versions (draft section 5): identified by key, width, height, the
// values of `deps` (plain data, compared deeply) and the paper in scope (R9).
// The table lives across frames; a version not asked for in the last two
// frames is dropped and recorded again when asked for. In testing mode the
// recorder re-records each asked-for version and compares (`firstDifference`).
import { SketchUsageError } from "../../core/errors.js";
import type { PaperSettings, PictureVersion, PixelsVersion } from "../nodes.js";

type Version = PictureVersion | PixelsVersion;

/** Why `value` is not plain data, with its path, or undefined when it is. */
function notPlain(value: unknown, at: { path: string; seen: Set<object> }): string | undefined {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return undefined;
  if (typeof value !== "object") return `${at.path} is a ${typeof value}`;
  if (at.seen.has(value)) return `${at.path} refers back to itself (a cycle)`;
  const proto: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    const name: unknown = typeof proto === "object" ? Reflect.get(Reflect.get(proto, "constructor") ?? {}, "name") : undefined;
    return `${at.path} is a ${typeof name === "string" && name !== "" ? name : "class"} instance`;
  }
  at.seen.add(value);
  for (const [k, v] of Object.entries(value)) {
    const why = notPlain(v, { path: Array.isArray(value) ? `${at.path}[${k}]` : `${at.path}.${k}`, seen: at.seen });
    if (why !== undefined) return why;
  }
  at.seen.delete(value);
  return undefined;
}

/** `deps` checked as plain data (numbers, strings, booleans, null, arrays and plain objects) and copied. */
export function copyDeps(deps: readonly unknown[] | undefined, key: string): readonly unknown[] | undefined {
  if (deps === undefined) return undefined;
  if (!Array.isArray(deps)) throw new SketchUsageError({ detail: `picture "${key}": deps must be an array` });
  const why = notPlain(deps, { path: "deps", seen: new Set() });
  if (why !== undefined) throw new SketchUsageError({ detail: `picture "${key}": deps must be plain data compared by value, but ${why}` });
  return structuredClone(deps);
}

/** Deep equality of plain data (and of scene nodes, whose picture versions compare by identity). */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (a instanceof Uint8Array || b instanceof Uint8Array) return a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((v, i) => v === b[i]);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (isVersion(a) || isVersion(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && sameData(Reflect.get(a, k), Reflect.get(b, k)));
}

function isVersion(x: object): boolean {
  const kind: unknown = Reflect.get(x, "kind");
  return (kind === "picture" || kind === "pixels") && Object.hasOwn(x, "key") && Object.hasOwn(x, "deps");
}

function nodeName(n: unknown, index: number): string {
  if (typeof n !== "object" || n === null) return `#${index}`;
  const call: unknown = Reflect.get(n, "call");
  const kind: unknown = Reflect.get(n, "kind");
  return `${typeof call === "string" ? call : typeof kind === "string" ? kind : "node"} #${index}`;
}

/** The path to the first node that differs between two recordings of one body, or undefined when they agree. */
export function firstDifference(pair: { a: readonly unknown[]; b: readonly unknown[] }, path: string): string | undefined {
  const { a, b } = pair;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x: unknown = a[i];
    const y: unknown = b[i];
    if (sameData(x, y)) continue;
    const here = `${path} > ${nodeName(x ?? y, i + 1)}`;
    for (const field of ["children", "body", "mask"]) {
      const cx: unknown = typeof x === "object" && x !== null ? Reflect.get(x, field) : undefined;
      const cy: unknown = typeof y === "object" && y !== null ? Reflect.get(y, field) : undefined;
      if (Array.isArray(cx) && Array.isArray(cy) && !sameData(cx, cy)) return firstDifference({ a: cx, b: cy }, here);
    }
    return here;
  }
  return undefined;
}

interface Entry {
  readonly version: Version;
  readonly made: number;
  lastAsked: number;
}

/** The versions a sketch's pictures have recorded, across frames. */
export class PictureTable {
  readonly #entries = new Map<string, Entry[]>();
  /** Per key: the last frame a new version was added, and how many frames running had one. */
  readonly #runs = new Map<string, { frame: number; run: number }>();
  #frame = 0;

  /** A new frame: drop versions not asked for in the last two. */
  beginFrame(): void {
    this.#frame++;
    for (const [key, list] of this.#entries) {
      const keep = list.filter((e) => e.lastAsked >= this.#frame - 2);
      if (keep.length === 0) this.#entries.delete(key);
      else this.#entries.set(key, keep);
    }
  }

  /** The version for these values, if recorded and kept. */
  find(id: { kind: Version["kind"]; key: string; width: number; height: number; deps: readonly unknown[] | undefined; paper?: PaperSettings }): Version | undefined {
    const hit = this.#entries.get(id.key)?.find((e) => {
      const v = e.version;
      return v.kind === id.kind && v.width === id.width && v.height === id.height && sameData(v.deps, id.deps) && (v.kind !== "picture" || sameData(v.paper, id.paper));
    });
    if (hit === undefined) return undefined;
    hit.lastAsked = this.#frame;
    return hit.version;
  }

  /** Add a new version; returns how many frames running (this one included) its key has added a new version. */
  add(version: Version): number {
    const list = this.#entries.get(version.key) ?? [];
    list.push({ version, made: this.#frame, lastAsked: this.#frame });
    this.#entries.set(version.key, list);
    const last = this.#runs.get(version.key);
    const run = last === undefined ? 1 : last.frame === this.#frame ? last.run : last.frame === this.#frame - 1 ? last.run + 1 : 1;
    this.#runs.set(version.key, { frame: this.#frame, run });
    return run;
  }

  /** Whether `version` was added this frame (so asking for it again this frame was a second call). */
  madeThisFrame(version: Version): boolean {
    return this.#entries.get(version.key)?.some((e) => e.version === version && e.made === this.#frame) === true;
  }

  /** Forget every version, so each picture records again (a web font loaded). */
  clear(): void {
    this.#entries.clear();
  }

  /** How many versions are kept (for transcripts and tests). */
  get size(): number {
    let n = 0;
    for (const list of this.#entries.values()) n += list.length;
    return n;
  }
}

/** What `v.picture` and `v.pixels` hand back: the version, behind the draft's opaque `Picture`. */
export class PictureHandle {
  readonly version: Version;
  /** The recorder's frame it was handed out in; `place` refuses it in another frame. */
  readonly frame: object;
  constructor(version: Version, frame: object) {
    this.version = version;
    this.frame = frame;
  }
  get width(): number {
    return this.version.width;
  }
  get height(): number {
    return this.version.height;
  }
  /** The draft's brand: never read. */
  get pictureBrand(): never {
    throw new SketchUsageError({ detail: "a Picture is opaque: place it with v.place" });
  }
}

/** The version behind a Picture `place` was given: one from `v.picture` or `v.pixels`, this frame (`frame`). */
export function placedVersion(picture: unknown, frame: object): Version {
  if (!(picture instanceof PictureHandle)) throw new SketchUsageError({ detail: "place: the picture must come from v.picture or v.pixels" });
  if (picture.frame !== frame) throw new SketchUsageError({ detail: `place(${picture.version.kind} "${picture.version.key}"): this Picture came from an earlier frame; call v.picture in each draw (it hands back the kept version without recording again) and place what it returns` });
  return picture.version;
}

/** A picture's key and size, checked; `pixels` needs whole pixels. */
export function checkPictureOptions(o: { key: unknown; width: unknown; height: unknown }, call: "picture" | "pixels"): { key: string; width: number; height: number } {
  const { key, width, height } = o;
  if (typeof key !== "string" || key === "") throw new SketchUsageError({ detail: `${call}: key must be a non-empty string` });
  for (const [name, v] of [["width", width], ["height", height]] as const) {
    const ok = typeof v === "number" && Number.isFinite(v) && v > 0 && (call === "picture" || (Number.isInteger(v) && v <= 4096));
    if (!ok) throw new SketchUsageError({ detail: `${call} "${key}": ${name} must be ${call === "pixels" ? "a whole number of pixels, 1..4096" : "a number > 0"}, got ${String(v)}` });
  }
  if (typeof width !== "number" || typeof height !== "number") throw new SketchUsageError({ detail: `${call}: width and height must be numbers` });
  return { key, width, height };
}
