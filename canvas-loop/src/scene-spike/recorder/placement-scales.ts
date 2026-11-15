// The section 10 performance hint: a picture placed at a new scale or
// rotation every frame is drawn again each frame, so its kept raster is never
// reused. Per key, each frame's placement linear parts are compared with the
// last frame's; a key placed at one it did not have last frame, three frames
// running, gets the hint. A key placed at several fixed scales does not.
import type { Mat } from "../scene.js";

/** The placement's scale, rotation and skew, rounded so float noise in a fixed transform compares equal. */
function linearOf(m: Mat): string {
  return m.slice(0, 4).map((v) => Math.round(v * 1e6) / 1e6).join(", ");
}

export class PlacementScales {
  #last = new Map<string, Set<string>>();
  #now = new Map<string, Set<string>>();
  /** Per key: the last frame it was placed at a new linear part, and how many frames running. */
  readonly #runs = new Map<string, { frame: number; run: number }>();
  #frame = 0;

  beginFrame(): void {
    this.#last = this.#now;
    this.#now = new Map();
    this.#frame++;
  }

  /** A top-level placement of `key` under `matrix`: the hint, once the key has had a new scale or rotation three frames running. */
  placed(key: string, matrix: Mat): string | undefined {
    const linear = linearOf(matrix);
    const now = this.#now.get(key) ?? new Set<string>();
    now.add(linear);
    this.#now.set(key, now);
    const last = this.#last.get(key);
    if (last === undefined || last.has(linear)) return undefined;
    const prev = this.#runs.get(key);
    const run = prev === undefined ? 1 : prev.frame === this.#frame ? prev.run : prev.frame === this.#frame - 1 ? prev.run + 1 : 1;
    this.#runs.set(key, { frame: this.#frame, run });
    if (run < 3) return undefined;
    return `picture "${key}" was placed at a new scale or rotation in each of the last ${run} frames (now [${linear}]), so it is drawn again every frame and its kept image is never reused; if it turns or scales all the time, draw it as a group instead, or keep its scale and rotation fixed and move it by position`;
  }
}
