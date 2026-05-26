/**
 * Map refresh state file.
 *
 * Records the commit hash each MAP.md was generated against, so the
 * precheck can detect adds/deletes since then via `git ls-tree`. Lives
 * at the box root (not under .callback-box/, which is gitignored) so
 * the cache is portable across machines.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface MapStateEntry {
  /** Commit hash this MAP.md was last generated against. */
  asOf: string;
  /** ISO timestamp of generation. */
  generatedAt: string;
}

export interface MapState {
  /** Keyed by directory path relative to box root ("" for the root). */
  maps: Record<string, MapStateEntry>;
}

export const MAP_STATE_FILE = ".cb-maps-state.json";

function stateFilePath(boxRoot: string): string {
  return path.join(boxRoot, MAP_STATE_FILE);
}

/** Load the state file. Returns an empty state if the file is missing or unreadable. */
export async function loadMapState(boxRoot: string): Promise<MapState> {
  try {
    const raw = await fs.readFile(stateFilePath(boxRoot), "utf-8");
    const parsed = JSON.parse(raw) as Partial<MapState>;
    if (!parsed.maps || typeof parsed.maps !== "object") {
      return { maps: {} };
    }
    return { maps: parsed.maps };
  } catch {
    return { maps: {} };
  }
}

export interface SaveMapStateOptions {
  boxRoot: string;
  state: MapState;
}

/** Write the state file with keys sorted for stable diffs. */
export async function saveMapState(options: SaveMapStateOptions): Promise<void> {
  const sorted: MapState = { maps: {} };
  for (const key of Object.keys(options.state.maps).toSorted()) {
    const entry = options.state.maps[key];
    if (entry) sorted.maps[key] = entry;
  }
  await fs.writeFile(
    stateFilePath(options.boxRoot),
    JSON.stringify(sorted, null, 2) + "\n",
  );
}
