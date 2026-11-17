// What new picture versions cost, by key: versions recorded (their bodies
// run) and picture tiles lowered for the GPU (their marks expanded and
// placed), with CPU milliseconds for each. A version is recorded once, and
// lowered once for each scale or rotation it is placed at, then reused; a
// key that keeps making versions pays both each time. Headless `--timing`
// lists it per captured frame; a browser figure's surface hands it out
// (`pictureCosts()`).

/** One key's cost since it was last read. */
export interface PictureCost {
  readonly key: string;
  /** New versions recorded, and the milliseconds their bodies and checks took. */
  readonly versions: number;
  readonly recordMs: number;
  /** Picture tiles lowered (each new version, at each new scale or rotation, a tile at a time), and the CPU milliseconds that took. */
  readonly tiles: number;
  readonly rasterMs: number;
}

type Mutable = { -readonly [K in keyof PictureCost]: PictureCost[K] };

export class PictureCosts {
  #by = new Map<string, Mutable>();

  #entry(key: string): Mutable {
    let e = this.#by.get(key);
    if (e === undefined) {
      e = { key, versions: 0, recordMs: 0, tiles: 0, rasterMs: 0 };
      this.#by.set(key, e);
    }
    return e;
  }

  recorded(list: readonly { key: string; ms: number }[]): void {
    for (const { key, ms } of list) {
      const e = this.#entry(key);
      e.versions++;
      e.recordMs += ms;
    }
  }

  lowered(list: readonly { key: string; tiles: number; ms: number }[]): void {
    for (const { key, tiles, ms } of list) {
      const e = this.#entry(key);
      e.tiles += tiles;
      e.rasterMs += ms;
    }
  }

  /** Each key's cost since the last `take`, costliest first; the counts start again. */
  take(): PictureCost[] {
    const out = [...this.#by.values()].toSorted((a, b) => b.recordMs + b.rasterMs - (a.recordMs + a.rasterMs));
    this.#by = new Map();
    return out;
  }
}

/** `wood-oak-2: 3 versions (4.1 ms), 12 tiles (31.0 ms)` for the costliest `limit` keys (6 when not given), or undefined for none. */
export function costLine(costs: readonly PictureCost[], limitGiven?: number): string | undefined {
  const limit = limitGiven ?? 6;
  if (costs.length === 0) return undefined;
  const ms = (n: number): string => n.toFixed(1);
  const n = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const shown = costs.slice(0, limit).map((c) => `${c.key}: ${n(c.versions, "version")} (${ms(c.recordMs)} ms), ${n(c.tiles, "tile")} (${ms(c.rasterMs)} ms)`);
  const rest = costs.length > limit ? `; ${costs.length - limit} more keys` : "";
  return shown.join("; ") + rest;
}
