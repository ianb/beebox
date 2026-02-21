/**
 * Path utilities for finding and working with callback box directories.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";

/** Standard directory names in a callback box */
export const BOX_DIRS = {
  // Working state
  inbox: "box/inbox",
  inboxUnhandled: "box/inbox/unhandled",
  jobs: "box/jobs",
  questions: "box/questions",
  resources: "box/resources",

  // Archives
  archiveDone: "store/archive/done",
  archiveFailed: "store/archive/failed",
  archiveProcessed: "store/archive/processed",
  trash: "store/trash",
  integrated: "store/integrated",
  recipes: "store/recipes",

  // Configuration
  config: "config",
  connectors: "config/connectors",
  schemas: "config/schemas",
  workflows: "config/workflows",

  // Agent configuration
  claude: ".claude",
  rules: ".claude/rules",
} as const;

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
    } catch {
      // Marker not found, try parent
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
    throw new Error(
      "Not in a callback box. Run 'cb init' to create one, or navigate to an existing box."
    );
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
 * Parse a card filename into its components.
 * Card names follow the pattern: Name.type.card
 *
 * @param filename - The card filename (e.g., "Meeting_Tomorrow.email-thread.card")
 * @returns Parsed components or null if not a valid card name
 */
export function parseCardName(filename: string): { name: string; type: string } | null {
  const match = filename.match(/^(.+)\.([^.]+)\.card$/);
  if (!match) {
    return null;
  }
  return {
    name: match[1]!,
    type: match[2]!,
  };
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
