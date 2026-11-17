// Picture versions (draft section 5): identified by key, width, height, the
// values of `deps` (plain data, compared deeply) and its paper option (R9).
// The table lives across frames. Versions not asked for in the last two
// frames stay while their recordings fit in about 16 MB, least recently asked
// for dropped first, so a pose a walk cycle shows again is not recorded again;
// a dropped version is recorded again when asked for. In testing mode the
// recorder re-records an asked-for version and compares (`firstDifference`)
// when an audit is due (`auditDue`): in the frame that made it, in the next
// `AUDIT_FIRST` frames, and then at the first ask `AUDIT_EVERY` frames or
// more after the last comparison.
import { SketchUsageError } from "../../core/errors.js";
import type { PaperSettings, PictureVersion, PixelsVersion } from "../nodes.js";
import { weightOf } from "../weight.js";

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

/** Whether a version was asked for again in a frame after the one that made it. */
interface Use {
  readonly made: number;
  again: boolean;
}

interface Entry {
  readonly version: Version;
  readonly made: number;
  lastAsked: number;
  /** The last frame testing mode compared it in. */
  audited: number;
  readonly use: Use;
  /** About how many bytes the recording holds. */
  readonly weight: number;
}

/** Bytes of recordings not asked for in the last two frames that the table keeps. */
const IDLE_BUDGET = 16 * 1024 * 1024;

/** Frames a new version has to be asked for again before the churn check counts it as used once: half a second, longer than a walk cycle's poses take to come back. */
export const REUSE_WINDOW = 30;

/** Testing mode compares a kept version in each of the frames after the one that made it, up to this many. */
export const AUDIT_FIRST = 2;

/** Then at the first ask this many frames (half a second) or more after the last comparison: a stale capture that lasts that long is still found, and a picture-heavy run does not record every body every frame. */
export const AUDIT_EVERY = 30;

/** The versions a sketch's pictures have recorded, across frames. */
export class PictureTable {
  readonly #entries = new Map<string, Entry[]>();
  /** Per key: the last frame a new version was added, how many frames running had one, and the uses of the versions added in the run's last `REUSE_WINDOW + 3` frames. */
  readonly #runs = new Map<string, { frame: number; run: number; uses: Use[] }>();
  #frame = 0;

  /** A new frame: drop the least recently asked-for versions while those not asked for in the last two frames weigh more than `IDLE_BUDGET`. */
  beginFrame(): void {
    this.#frame++;
    const idle = [...this.#entries.values()].flat().filter((e) => e.lastAsked < this.#frame - 2);
    let weight = idle.reduce((n, e) => n + e.weight, 0);
    if (weight <= IDLE_BUDGET) return;
    const drop = new Set<Entry>();
    for (const e of idle.toSorted((a, b) => a.lastAsked - b.lastAsked)) {
      if (weight <= IDLE_BUDGET) break;
      weight -= e.weight;
      drop.add(e);
    }
    for (const [key, list] of this.#entries) {
      const keep = list.filter((e) => !drop.has(e));
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
    if (hit.made < this.#frame) hit.use.again = true;
    return hit.version;
  }

  /**
   * Add a new version. Returns how many frames running its key has added a
   * new version when the key churns, else `undefined`. A key churns when it
   * has added a new version in every frame for longer than `REUSE_WINDOW`
   * and most of the versions it added `REUSE_WINDOW` to `REUSE_WINDOW + 2`
   * frames ago were never asked for again. A walk cycle adds versions in a
   * row of frames while it first shows its poses (every frame, at a high game
   * speed), but its poses come back within the window.
   */
  add(version: Version): number | undefined {
    const use: Use = { made: this.#frame, again: false };
    const list = this.#entries.get(version.key) ?? [];
    list.push({ version, made: this.#frame, lastAsked: this.#frame, audited: this.#frame, use, weight: weightOf(version) });
    this.#entries.set(version.key, list);
    const last = this.#runs.get(version.key);
    const run = last === undefined ? 1 : last.frame === this.#frame ? last.run : last.frame === this.#frame - 1 ? last.run + 1 : 1;
    const oldest = this.#frame - REUSE_WINDOW - 2;
    const uses = [...(run === 1 || last === undefined ? [] : last.uses.filter((u) => u.made >= oldest)), use];
    this.#runs.set(version.key, { frame: this.#frame, run, uses });
    if (run < REUSE_WINDOW + 3) return undefined;
    const judged = uses.filter((u) => u.made <= this.#frame - REUSE_WINDOW);
    return judged.filter((u) => !u.again).length * 2 > judged.length ? run : undefined;
  }

  /**
   * Whether testing mode should record `version` again and compare: a second
   * ask in the frame that made it, its next `AUDIT_FIRST` frames, then the
   * first ask at least `AUDIT_EVERY` frames after the last comparison. Every
   * ask in a frame that compares is compared, so two drawings sharing a key
   * are found whichever asks first.
   */
  auditDue(version: Version): boolean {
    const entry = this.#entries.get(version.key)?.find((e) => e.version === version);
    if (entry === undefined) return true;
    const due = this.#frame - entry.made <= AUDIT_FIRST || entry.audited === this.#frame || this.#frame - entry.audited >= AUDIT_EVERY;
    if (due) entry.audited = this.#frame;
    return due;
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
