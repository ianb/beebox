/**
 * Path utilities for finding and working with Bee Box directories.
 */

import { withBoxWork } from "../box-maintenance/admission.js";
import * as path from "node:path";
import { BOX_LAYOUT, type BoxDirs, type BoxDirsEntry, type BoxLayoutEntry } from "./box-layout-spec.js";
import { invariant } from "../../shared/invariant.js";
import { LEGACY_BOX_MARKER, LEGACY_BOX_STATE_DIR, migrateBoxState } from "../state-migration.js";
import { probeBoxLevel } from "../box-identity.js";
import { fileExists } from "../file-exists.js";
import { isWithin } from "../box-containment.js";

export type { BoxDirs, BoxLayoutEntry } from "./box-layout-spec.js";

export class NotInBoxError extends Error {
  constructor() {
    super("Not in a Bee Box. Run 'bbx engine init' to create one, or navigate to an existing box.");
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
 * `test/lib/paths/box-layout-spec.test.ts`) and the in-box agent guide
 * (`src/core/agent-guide/guide/box-shape.ts`) — add, remove, or rename a directory
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

/**
 * Find the Bee Box root by searching upward from the given path. A box has
 * ONE root (shapeVersion 3); each level is checked by `probeBoxLevel`
 * (`box-identity.ts`): a `package.json` declaring `beebox` beside `_config/`,
 * the fallback marker, or the retired-name marker.
 *
 * A box-like level whose shape this build cannot open throws instead of being
 * returned — a v2 package root, a marker below shapeVersion 3, a box with no
 * recorded version. Handing back such a root would let a caller read
 * `_content/` or `_config/` under it, find nothing, and report false success
 * (the original bug: `bbx tick` inside a v2 `content/` dir found zero jobs).
 *
 * @param startPath - Directory to start searching from
 * @returns The box root path, or null if nothing box-like exists anywhere above it
 * @throws BoxShapeError for a box-like level this build cannot open
 */
export async function findBoxRoot(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);

  for (;;) {
    if (await probeBoxLevel(current)) return current;
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
  if (await fileExists(path.join(root, LEGACY_BOX_STATE_DIR)) || await fileExists(path.join(root, LEGACY_BOX_MARKER))) {
    await withBoxWork({ boxRoot: root, reason: "state migration" }, () => migrateBoxState(root));
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

  if (!isWithin(resolvedRoot, resolved)) {
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
 * Check if a path is box view source: a view (`isViewFile`) or a helper it may
 * import, i.e. any `.ts`/`.tsx` under a `views/` directory (`views/lib/…`).
 * The Markdown check (`core/views/markdown-check.ts`) runs on all of them; the
 * compile check only on views.
 */
export function isViewSourceFile(filePath: string): boolean {
  return /(^|\/)views\/.+\.tsx?$/.test(filePath);
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
