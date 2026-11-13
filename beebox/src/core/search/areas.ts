/**
 * Search areas: named groups of path prefixes that default search holds back.
 *
 * A box with thousands of saved sources keeps them in an area, so a default
 * search returns the written cards first and reports how many hits it held
 * back. An area is not access control: `--area` and a path prefix inside it
 * reach it. `_tmp/` is held back the same way but never reported.
 */

import type { SearchConfig } from "../box/config.js";

/** Scratch space; held back from default search and not counted. */
const TMP_PREFIX = "_tmp";

/** The `--area` value that removes nothing. */
const ALL_AREAS = "all";

/** An unknown --area value; carries the valid set for the error message. */
export class UnknownAreaError extends Error {
  readonly area: string;
  readonly validAreas: string[];
  constructor({ area, validAreas, configWarning }: { area: string; validAreas: string[]; configWarning: string | null }) {
    const note = configWarning === null ? "" : ` (${configWarning})`;
    super(`unknown area "${area}" — valid areas: ${validAreas.join(", ")}${note}`);
    this.name = "UnknownAreaError";
    this.area = area;
    this.validAreas = validAreas;
  }
}

/** Whether `path` is `prefix` or lies under it, compared by path segment. */
function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function trimSlashes(prefix: string): string {
  return prefix.replace(/\/+$/, "");
}

export interface AreaFilter {
  /** Whether a hit's path is kept in the results. */
  keep(path: string): boolean;
  /** The configured areas holding a path back; empty for a kept path and for `_tmp/`, which is not reported. */
  reportedAreas(path: string): string[];
}

/**
 * Decide which hits an area setting keeps.
 *
 * - No `area`: hits under an area prefix or `_tmp/` are held back, unless a
 *   caller path prefix that the hit matches lies inside that held prefix.
 * - A name: only hits under that area's prefixes.
 * - `all`: nothing is held back.
 *
 * `callerPrefixes` are the raw `--path` values; they are compared by segment
 * here, while the caller's own path filter keeps its plain string-prefix match.
 */
export function buildAreaFilter({
  area,
  config,
  callerPrefixes,
  configWarning,
}: {
  area: string | undefined;
  config: SearchConfig;
  callerPrefixes: string[];
  configWarning: string | null;
}): AreaFilter {
  const names = Object.keys(config.areas);
  if (area !== undefined && area !== ALL_AREAS && !names.includes(area)) {
    throw new UnknownAreaError({ area, validAreas: [...names.toSorted(), ALL_AREAS], configWarning });
  }
  const callerMatches = (path: string): string[] =>
    callerPrefixes.filter((prefix) => path.startsWith(prefix)).map(trimSlashes);

  if (area === ALL_AREAS) {
    return { keep: () => true, reportedAreas: () => [] };
  }
  if (area !== undefined) {
    const prefixes = config.areas[area] ?? [];
    const inArea = (path: string): boolean => prefixes.some((prefix) => underPrefix(path, prefix));
    return { keep: inArea, reportedAreas: () => [] };
  }

  const held = [
    ...names.map((name) => ({ name, prefixes: config.areas[name] ?? [], reported: true })),
    { name: TMP_PREFIX, prefixes: [TMP_PREFIX], reported: false },
  ];
  const heldBy = (path: string): typeof held => {
    const matches = callerMatches(path);
    return held.filter(({ prefixes }) =>
      prefixes.some((prefix) => underPrefix(path, prefix) && !matches.some((caller) => underPrefix(caller, prefix)))
    );
  };
  return {
    keep: (path) => heldBy(path).length === 0,
    reportedAreas: (path) => heldBy(path).filter(({ reported }) => reported).map(({ name }) => name),
  };
}

/** Whether an area or weight setting forces the search to look at every match. */
export function needsFullFetch({
  area,
  config,
}: {
  area: string | undefined;
  config: SearchConfig;
}): boolean {
  return area !== ALL_AREAS || Object.keys(config.kindWeights).length > 0;
}

/**
 * Apply an area filter and kind weights to matches. Returns the kept items
 * with their weighted score, and the per-area count of held-back items in the
 * config's area order (areas that held nothing are left out).
 */
export function applyAreas<T>({
  items,
  filter,
  config,
  describe,
}: {
  items: T[];
  filter: AreaFilter;
  config: SearchConfig;
  describe: (item: T) => { path: string; kind: string; score: number };
}): { kept: { item: T; score: number }[]; heldBack: { area: string; count: number }[] } {
  const heldCounts = new Map<string, number>();
  const kept: { item: T; score: number }[] = [];
  for (const item of items) {
    const { path, kind, score } = describe(item);
    if (filter.keep(path)) kept.push({ item, score: score * (config.kindWeights[kind] ?? 1) });
    for (const area of filter.reportedAreas(path)) heldCounts.set(area, (heldCounts.get(area) ?? 0) + 1);
  }
  const heldBack = Object.keys(config.areas)
    .map((area) => ({ area, count: heldCounts.get(area) ?? 0 }))
    .filter(({ count }) => count > 0);
  return { kept, heldBack };
}

/** Every box-relative prefix of every configured area. */
export function areaPrefixes(config: SearchConfig): string[] {
  return Object.values(config.areas).flat();
}
