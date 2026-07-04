/**
 * Path utilities for finding and working with callback box directories.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { BOX_LAYOUT, type BoxDirs, type BoxDirsEntry, type BoxLayoutEntry } from "./box-layout-spec.js";

export type { BoxDirs, BoxLayoutEntry } from "./box-layout-spec.js";

class NotInBoxError extends Error {
  constructor() {
    super("Not in a callback box. Run 'cb init' to create one, or navigate to an existing box.");
    this.name = "NotInBoxError";
  }
}

export class UnknownBoxDirsKeyError extends Error {
  constructor(boxDirsKey: string) {
    super(`No box-layout-spec entry for BOX_DIRS key "${boxDirsKey}".`);
    this.name = "UnknownBoxDirsKeyError";
  }
}

/**
 * Standard directory names in a callback box, derived from the single
 * `BOX_LAYOUT` spec in `box-layout-spec.ts`. That file is also the source
 * for `docs/box-layout.md`'s tables (checked by
 * `test/cli/lib/box-layout-spec.doctest.md`) and the in-box agent guide
 * (`src/core/agent-guide/box-shape.ts`) — add, remove, or rename a directory
 * there, not here.
 */
export const BOX_DIRS: BoxDirs = Object.fromEntries(
  BOX_LAYOUT.filter(
    (entry): entry is BoxDirsEntry => "boxDirsKey" in entry && entry.boxDirsKey !== undefined
  ).map((entry) => [entry.boxDirsKey, entry.path])
) as BoxDirs;

/** Look up a `box-layout-spec.ts` entry by its `BOX_DIRS` key, for callers that also need its prose. */
export function boxLayoutEntry(boxDirsKey: keyof BoxDirs): BoxLayoutEntry {
  const entry = BOX_LAYOUT.find((candidate) => "boxDirsKey" in candidate && candidate.boxDirsKey === boxDirsKey);
  if (!entry) {
    throw new UnknownBoxDirsKeyError(boxDirsKey);
  }
  return entry;
}

/** Marker file indicating a valid callback box root */
export const BOX_MARKER = ".cb-box";

/**
 * Find the callback box root by searching upward from the given path.
 *
 * @param startPath - Directory to start searching from
 * @returns The box root path, or null if not found
 */
export async function findBoxRoot(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);

  while (true) {
    const markerPath = path.join(current, BOX_MARKER);
    try {
      await fs.access(markerPath);
      return current;
    } catch (_e) {
      // Marker absent at this level — the only meaningful outcome of access()
      // here; walk up to the parent. No actionable info in the error.
    }

    const parent = path.dirname(current);
    if (parent === current) {
      // Reached filesystem root
      return null;
    }
    current = parent;
  }
}

/**
 * Get the box root, throwing if not found.
 *
 * @param startPath - Directory to start searching from (defaults to cwd)
 * @returns The box root path
 * @throws Error if not in a callback box
 */
export async function requireBoxRoot(startPath?: string): Promise<string> {
  const root = await findBoxRoot(startPath ?? process.cwd());
  if (!root) {
    throw new NotInBoxError();
  }
  return root;
}

/**
 * Resolve a path relative to the box root.
 *
 * @param boxRoot - The box root directory
 * @param relativePath - Path relative to box root
 * @returns Absolute path
 */
export function boxPath(boxRoot: string, relativePath: string): string {
  return path.join(boxRoot, relativePath);
}

/**
 * Get the path to a specific box directory.
 *
 * @param boxRoot - The box root directory
 * @param dir - The directory key from BOX_DIRS
 * @returns Absolute path to the directory
 */
export function getBoxDir(boxRoot: string, dir: keyof typeof BOX_DIRS): string {
  return path.join(boxRoot, BOX_DIRS[dir]);
}

/**
 * Convert an absolute path to a path relative to the box root.
 *
 * @param boxRoot - The box root directory
 * @param absolutePath - An absolute path within the box
 * @returns Path relative to box root, or null if outside the box
 */
export function toRelativePath(boxRoot: string, absolutePath: string): string | null {
  const resolved = path.resolve(absolutePath);
  const resolvedRoot = path.resolve(boxRoot);

  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    return null;
  }

  return path.relative(resolvedRoot, resolved);
}

/**
 * Parse a card filename into its components: nominal `Name.type.card`, or
 * positional `type.card` ("the ‹type› of this directory") where the name
 * doubles as the type for display purposes.
 *
 * Legacy divergence from src/shared/card-name.ts (the canonical grammar):
 * job cards parse here as `{ name: "Foo.intake", type: "job" }` rather than
 * `{ name: "Foo", type: "intake-job" }`. Callers depend on the flat split;
 * unify when they're audited.
 *
 * @param filename - The card filename (e.g., "Meeting_Tomorrow.email-thread.card")
 * @returns Parsed components or null if not a valid card name
 */
export function parseCardName(filename: string): { name: string; type: string } | null {
  const match = filename.match(/^(.+)\.([^.]+)\.card$/);
  if (match) {
    return {
      name: match[1]!,
      type: match[2]!,
    };
  }
  const positional = filename.match(/^([^.]+)\.card$/);
  if (positional) {
    return {
      name: positional[1]!,
      type: positional[1]!,
    };
  }
  return null;
}

/**
 * Build a card filename from components.
 *
 * @param name - The card name (e.g., "Meeting_Tomorrow")
 * @param type - The card type (e.g., "email-thread")
 * @returns The card filename (e.g., "Meeting_Tomorrow.email-thread.card")
 */
export function buildCardName(name: string, type: string): string {
  return `${name}.${type}.card`;
}

/**
 * Check if a path is a card file.
 *
 * @param filePath - The path to check
 * @returns Whether it's a card file
 */
export function isCardFile(filePath: string): boolean {
  return filePath.endsWith(".card");
}

export function isMarkdownFile(filePath: string): boolean {
  return filePath.endsWith(".md");
}

/**
 * Check if a path is an agent-authored view: a `.tsx` directly in a box's
 * `views/` directory (matching the `views/*.tsx` glob the compiler scans).
 */
export function isViewFile(filePath: string): boolean {
  return /(^|\/)views\/[^/]+\.tsx$/.test(filePath);
}
