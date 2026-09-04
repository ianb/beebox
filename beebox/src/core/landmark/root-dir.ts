/**
 * The v3 one-root layout moved the box's ROOT landmark card off the physical
 * box root and into `_content/` (`_content/Box.landmark.card`) — content is
 * the only open-vocabulary area at the root (`lib/box-layout-spec.ts`). The
 * logical meaning of a box-relative landmark `dir` of `""` (the box-root
 * chat/navigation scope) is unchanged; only where that scope's card lives on
 * disk moved. Every resolver that special-cases `dir === ""` to mean "scan
 * the box root" or that derives a landmark's `dir` from `path.dirname` of its
 * card path needs to go through the pair of helpers below instead of
 * hand-rolling the v2 assumption that the root landmark sits at the box
 * root itself.
 *
 * No `BOX_DIRS` key covers the bare `_content` area (its `box-layout-spec.ts`
 * entries are subdirectories under it) — this literal mirrors the one
 * `installRootLandmark` (`core/box/defaults.ts`) already uses to
 * scaffold/repair the same card.
 */

import * as path from "node:path";

/** The one-root layout's content area — the physical home of the root landmark card. */
export const LANDMARK_CONTENT_DIR = "_content";

/**
 * The physical directory to scan for the landmark card serving a logical
 * box-relative `dir` ("" = the box-root scope, which now scans the box's
 * content root rather than the box's physical root).
 */
export function landmarkScanDir(boxRoot: string, dir: string): string {
  return path.join(boxRoot, dir === "" ? LANDMARK_CONTENT_DIR : dir);
}

/**
 * Box-relative path to a landmark card that serves `dir`, given only its
 * bare filename within `landmarkScanDir(boxRoot, dir)`.
 */
export function landmarkRelPath(dir: string, cardName: string): string {
  return dir === "" ? `${LANDMARK_CONTENT_DIR}/${cardName}` : `${dir}/${cardName}`;
}

/**
 * Normalize a raw directory (typically `path.dirname(relPath)` of a
 * `*.landmark.card` match) back to the logical box-relative dir: both `"."`
 * (a box-root-relative path with no directory segment) and the bare content
 * area (the ROOT landmark's real parent since the one-root migration) mean
 * the box-root scope, `""`.
 */
export function normalizeLandmarkDir(rawDir: string): string {
  return rawDir === "." || rawDir === LANDMARK_CONTENT_DIR ? "" : rawDir;
}
