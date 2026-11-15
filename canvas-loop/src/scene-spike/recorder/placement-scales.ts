// The section 10 performance hint: a picture placed at a scale or rotation
// it has no kept image for is drawn again. This mirrors the renderer's raster
// cache (gpu/lower.ts `#placeTiles`, gpu/rasters.ts): a version's kept image
// is keyed by the placement's linear part, exactly (`linearKey`), and is kept
// while it was placed in one of the last two frames. A placement of a version
// already placed elsewhere that finds no kept image is a miss; a key with a
// miss three frames running gets the hint. A version's first placement is not
// a miss (a new version is the deps warning's business), and a key placed at
// several fixed scales, even in turn, reuses its images and gets none.
import { linearKey } from "../hash.js";
import type { Mat, PictureVersion } from "../scene.js";

export class PlacementScales {
  /** Per version: each linear part it was placed at, and the last frame it was. */
  readonly #kept = new WeakMap<PictureVersion, Map<string, number>>();
  /** Per key: the last frame with a miss, and how many frames running had one. */
  readonly #runs = new Map<string, { frame: number; run: number }>();
  #frame = 0;

  beginFrame(): void {
    this.#frame++;
  }

  /** A top-level placement of `version` under `matrix`: the hint, once its key has missed three frames running. */
  placed(version: PictureVersion, matrix: Mat): string | undefined {
    const linear = linearKey(matrix);
    const seen = this.#kept.get(version) ?? new Map<string, number>();
    this.#kept.set(version, seen);
    const last = seen.get(linear);
    const miss = seen.size > 0 && (last === undefined || last < this.#frame - 2);
    seen.set(linear, this.#frame);
    for (const [k, f] of seen) if (f < this.#frame - 2) seen.delete(k);
    if (!miss) return undefined;
    const prev = this.#runs.get(version.key);
    const run = prev === undefined ? 1 : prev.frame === this.#frame ? prev.run : prev.frame === this.#frame - 1 ? prev.run + 1 : 1;
    this.#runs.set(version.key, { frame: this.#frame, run });
    if (run < 3) return undefined;
    const now = matrix.slice(0, 4).map((v) => Math.round(v * 1e6) / 1e6).join(", ");
    return `picture "${version.key}" was placed at a scale or rotation it has no kept image for in each of the last ${run} frames (now [${now}]), so it is drawn again every frame; if it turns or scales all the time, draw it as a group instead, or keep its scale and rotation fixed and move it by position`;
  }
}
