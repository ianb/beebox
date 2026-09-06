/**
 * The box-wide `background` cascade (`docs/plans/card-prominence.md`, "Box-wide
 * cascade"): a landmark written `prominence: background` drops off the
 * Landmarks page (`landmarks.list`) and the switch menu (`chat.placeMenu`),
 * and so does every landmark nested under it — a directory doesn't stop
 * being a housekeeping area partway down. One function, used by both.
 */

import { parentLandmarkDir } from "./prominence-index.js";
import type { ProminenceLevel } from "../../shared/prominence.js";

export interface LandmarkPlace {
  /** Box-relative directory the landmark lives in. */
  dir: string;
  /** The landmark's own WRITTEN `prominence`, or null when absent. */
  prominence: ProminenceLevel | null;
}

/**
 * Whether `landmark` belongs in a box-wide listing: false when it is itself
 * written `background`, or when ANY ancestor directory's landmark is —
 * walking every ancestor directory up to the root, not only the nearest
 * landmark-holding one, so a background landmark two levels up still folds
 * a grandchild even through an intervening non-background landmark.
 * `others` is every other landmark in the box (any order, self excluded or
 * not — the walk never queries `landmark.dir` itself).
 */
export function isListedLandmark(landmark: LandmarkPlace, others: LandmarkPlace[]): boolean {
  if (landmark.prominence === "background") return false;
  const byDir = new Map(others.map((o) => [o.dir, o]));
  for (let cursor = parentLandmarkDir(landmark.dir); cursor !== null; cursor = parentLandmarkDir(cursor)) {
    if (byDir.get(cursor)?.prominence === "background") return false;
  }
  return true;
}
