/**
 * The below-root reserved-name rule
 * (`issues/features/2026-09-05-disallow-underscore-area-names-below-root.md`):
 * the underscore-area names are reserved words, legal only as a path's FIRST
 * segment — a nested `_content`, `_config`, `_bookkeeping`, or `_publish`
 * (directory or file) reads like machinery but isn't, and confuses the
 * display-path vocabulary, which derives labels from the first segment.
 *
 * `_tmp` is the deliberate exception (boxholder decision, 2026-09-05): it
 * acts the same at any depth — the box `.gitignore` ships an unanchored
 * `_tmp/` pattern, so a nested one is already ignored anywhere.
 *
 * `_config/_template-updates/` is exempt as a subtree: it mirrors
 * box-relative destination paths (parked template updates keyed by where
 * they'd land), so area names below it are structural, not strays.
 */

import { BOX_ROOT_VOCABULARY } from "./box-root-vocabulary.js";

const NON_NESTABLE_AREA_NAMES: ReadonlySet<string> = new Set(
  BOX_ROOT_VOCABULARY.filter((entry) => entry.kind === "area" && entry.name !== "_tmp").map(
    (entry): string => entry.name
  )
);

const TEMPLATE_UPDATES_PREFIX = "_config/_template-updates/";

/**
 * Find the first below-root segment of a box-relative path (forward-slash
 * separated, no leading slash) that names a non-nestable underscore area.
 * Returns `null` for a clean path, the empty path, and anything under the
 * template-updates mirror.
 */
export function findReservedNestedSegment(relativePath: string): string | null {
  if (relativePath === "" || relativePath.startsWith(TEMPLATE_UPDATES_PREFIX)) return null;
  const segments = relativePath.split("/");
  for (const segment of segments.slice(1)) {
    if (NON_NESTABLE_AREA_NAMES.has(segment)) return segment;
  }
  return null;
}

/** The caller-facing explanation for a {@link findReservedNestedSegment} hit. */
export function reservedNestedSegmentMessage(relativePath: string, segment: string): string {
  return (
    `${relativePath}: "${segment}" is a reserved box-area name, legal only at the box root ` +
    "(a nested _tmp is the one exception) — rename this entry"
  );
}
