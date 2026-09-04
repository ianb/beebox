/**
 * Path utilities for finding and working with Bee Box directories.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { BOX_LAYOUT, type BoxDirs, type BoxDirsEntry, type BoxLayoutEntry } from "./box-layout-spec.js";
import { invariant } from "./invariant.js";
import { LEGACY_BOX_MARKER, migrateBoxState } from "./state-migration.js";

export type { BoxDirs, BoxLayoutEntry } from "./box-layout-spec.js";

class NotInBoxError extends Error {
  constructor() {
    super("Not in a Bee Box. Run 'bbx init' to create one, or navigate to an existing box.");
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
 * Standard directory names in a Bee Box, derived from the single
 * `BOX_LAYOUT` spec in `box-layout-spec.ts`. That file is also the source
 * for `docs/box-layout.md`'s tables (checked by
 * `test/cli/lib/box-layout-spec.doctest.md`) and the in-box agent guide
 * (`src/core/agent-guide/box-shape.ts`) — add, remove, or rename a directory
 * there, not here.
 */
export const BOX_DIRS: BoxDirs =
  // eslint-disable-next-line no-restricted-syntax -- Object.fromEntries widens to a string index signature; the filtered BoxDirsEntry list reconstructs exactly the BoxDirs mapped type, which TS can't infer through fromEntries
  Object.fromEntries(
    BOX_LAYOUT.filter(
      (entry): entry is BoxDirsEntry => "boxDirsKey" in entry
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

/** Marker file indicating a valid Bee Box root */
/** Canonical marker lives in the persisted state directory. */
export const BOX_MARKER = ".beebox/box.json";
/** Marker name accepted only as an input to the one-shot state migration. */

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch (_e) {
    // Absent — the only meaningful outcome of access() here.
    return false;
  }
}

/**
 * Find the Bee Box root by searching upward from the given path. A box has
 * ONE root (shapeVersion 3): the marker check at each level is the whole
 * algorithm. A v2 box (marker one level down, at `<dir>/content/`) is no
 * longer resolved here — `getBoxShape`'s migration-pointing error is what
 * surfaces that case, not a silent downward resolve.
 *
 * @param startPath - Directory to start searching from
 * @returns The box root path, or null if not found
 */
export async function findBoxRoot(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);

  for (;;) {
    if (
      (await pathExists(path.join(current, BOX_MARKER))) ||
      (await pathExists(path.join(current, LEGACY_BOX_MARKER)))
    ) {
      return current;
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
 * @throws Error if not in a Bee Box
 */
export async function requireBoxRoot(startPath?: string): Promise<string> {
  const root = await findBoxRoot(startPath ?? process.cwd());
  if (!root) {
    throw new NotInBoxError();
  }
  // State directory names are persisted identity. Migrate before callers
  // construct any per-box path so a first `bbx` invocation cannot split state
  // between the retired and canonical directories.
  await migrateBoxState(root);
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
    const [, name, type] = match;
    invariant(name !== undefined && type !== undefined, "regex capture groups missing on a successful match");
    return { name, type };
  }
  const positional = filename.match(/^([^.]+)\.card$/);
  if (positional) {
    const [, name] = positional;
    invariant(name !== undefined, "regex capture group missing on a successful match");
    return { name, type: name };
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

/**
 * Cards under `_bookkeeping/trash/` are by definition orphaned/discarded and
 * routinely have broken refs (their attachments and related cards have been
 * deleted), so the *implicit* box-wide walks skip them — `bbx validate`'s
 * default scan and the `--canonical` normalizer alike. An explicit
 * `bbx validate <path>` on a trash path still validates.
 */
export function isTrashedCard(boxRelOrAbs: string): boolean {
  return /(^|\/)_bookkeeping\/trash\//.test(boxRelOrAbs);
}
