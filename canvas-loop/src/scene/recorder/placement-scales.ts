// The section 10 performance hint: a picture placed at a scale or rotation
// it has no kept image for is drawn again. This mirrors the renderer's raster
// cache (gpu/lower.ts `#placeTiles`, gpu/rasters.ts): a version's kept image
// is keyed by the placement's linear part, exactly (`linearKey`), and is kept
// after it was last placed, within a budget (here: its last `KEEP` linear
// parts). A placement of a version already placed elsewhere that finds no
// kept image is a miss; a key with a miss three frames running gets the hint.
// A version's first placement is not a miss (a new version is the deps
// warning's business), and a key placed at several fixed scales, even in
// turn, reuses its images and gets none. When the version that missed is new
// (first placed this frame or the last) and the key got a new version in each
// frame of the run, the hint names new versions as the cause: each one is
// drawn again at every scale it is placed at.
import { linearKey } from "../hash.js";
import type { Mat, PictureVersion } from "../nodes.js";

/** Linear parts remembered per version; past this many, the least recently placed is forgotten. */
const KEEP = 32;


export class PlacementScales {
  /** Per version: the linear parts it was placed at, least recently placed first. */
  readonly #kept = new WeakMap<PictureVersion, Set<string>>();
  /** Per version: the frame it was first placed. */
  readonly #born = new WeakMap<PictureVersion, number>();
  /** Per key: the last frame a version of it was first placed, and how many frames running had one. */
  readonly #added = new Map<string, { frame: number; run: number }>();
  /** Per key: the last frame with a miss, and how many frames running had one. */
  readonly #runs = new Map<string, { frame: number; run: number }>();
  #frame = 0;

  beginFrame(): void {
    this.#frame++;
  }

  /** A top-level placement of `version` under `matrix`: the hint, once its key has missed three frames running. */
  placed(version: PictureVersion, matrix: Mat): string | undefined {
    const linear = linearKey(matrix);
    let seen = this.#kept.get(version);
    if (seen === undefined) {
      seen = new Set<string>();
      this.#kept.set(version, seen);
      this.#born.set(version, this.#frame);
      const added = this.#added.get(version.key);
      this.#added.set(version.key, { frame: this.#frame, run: added === undefined ? 1 : added.frame === this.#frame ? added.run : added.frame === this.#frame - 1 ? added.run + 1 : 1 });
    }
    const miss = seen.size > 0 && !seen.has(linear);
    // Re-inserted, so the set's order is least recently placed first.
    seen.delete(linear);
    seen.add(linear);
    for (const k of seen) {
      if (seen.size <= KEEP) break;
      seen.delete(k);
    }
    if (!miss) return undefined;
    const prev = this.#runs.get(version.key);
    const run = prev === undefined ? 1 : prev.frame === this.#frame ? prev.run : prev.frame === this.#frame - 1 ? prev.run + 1 : 1;
    this.#runs.set(version.key, { frame: this.#frame, run });
    if (run < 3) return undefined;
    const now = matrix.slice(0, 4).map((v) => Math.round(v * 1e6) / 1e6).join(", ");
    const added = this.#added.get(version.key);
    const young = this.#frame - (this.#born.get(version) ?? 0) <= 1;
    if (young && added !== undefined && added.frame === this.#frame && added.run >= run) {
      const deps = version.deps === undefined ? "no deps" : `deps ${JSON.stringify(version.deps)}`;
      return `picture "${version.key}" got new versions in each of the last ${run} frames (now ${deps}), each placed at more than one scale or rotation (now [${now}]); a new version is recorded and drawn again at every scale it is placed at, so this key costs a full draw several times a frame; use fewer versions (coarser deps), or give each scale its own key so versions come back`;
    }
    return `picture "${version.key}" was placed at a scale or rotation it has no kept image for in each of the last ${run} frames (now [${now}]), so it is drawn again every frame; if it turns or scales all the time, draw it as a group instead, or keep its scale and rotation fixed and move it by position`;
  }
}
