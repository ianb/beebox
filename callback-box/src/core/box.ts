/**
 * Box directory structure operations.
 *
 * Creates and manages the standard directory layout for a callback box.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BOX_DIRS, BOX_MARKER, boxPath } from "../cli/lib/paths.js";
import { initRepo, stageAll, commit, isRepo } from "../cli/lib/git.js";

export interface InitOptions {
  /** Skip git initialization */
  skipGit?: boolean | undefined;
  /** Initial branch name */
  branch?: string | undefined;
}

/**
 * Initialize a new callback box at the given path.
 *
 * @param boxRoot - Directory to initialize (will be created if needed)
 * @param options - Initialization options
 */
export async function initBox(boxRoot: string, options: InitOptions = {}): Promise<void> {
  const resolvedRoot = path.resolve(boxRoot);

  // Create root directory if needed
  await fs.mkdir(resolvedRoot, { recursive: true });

  // Check if already initialized
  const markerPath = path.join(resolvedRoot, BOX_MARKER);
  try {
    await fs.access(markerPath);
    throw new Error(`Directory is already a callback box: ${resolvedRoot}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  // Create all standard directories
  await ensureDirectories(resolvedRoot);

  // Create marker file with metadata
  const marker = {
    version: "1.0.0",
    created: new Date().toISOString(),
  };
  await fs.writeFile(markerPath, JSON.stringify(marker, null, 2) + "\n");

  // Create .gitignore
  const gitignore = `# Callback Box .gitignore
# Lock files
.cb-lock

# Local config (credentials, etc.)
config/connectors/*.secret.*

# Temporary files
*.tmp
*.swp
*~
`;
  await fs.writeFile(path.join(resolvedRoot, ".gitignore"), gitignore);

  // Initialize git repo
  if (!options.skipGit) {
    const isExistingRepo = await isRepo(resolvedRoot);
    if (!isExistingRepo) {
      await initRepo(resolvedRoot, options.branch ?? "main");
    }

    // Initial commit
    await stageAll(resolvedRoot);
    await commit(resolvedRoot, {
      message: "Initialize callback box",
      trailers: {
        "Created-By": "cb init",
      },
    });
  }
}

/**
 * Ensure all standard directories exist.
 *
 * @param boxRoot - The box root directory
 */
export async function ensureDirectories(boxRoot: string): Promise<void> {
  const dirs = Object.values(BOX_DIRS);

  for (const dir of dirs) {
    const fullPath = boxPath(boxRoot, dir);
    await fs.mkdir(fullPath, { recursive: true });

    // Create .gitkeep to preserve empty directories
    const gitkeep = path.join(fullPath, ".gitkeep");
    try {
      await fs.access(gitkeep);
    } catch {
      await fs.writeFile(gitkeep, "");
    }
  }
}

/**
 * Check if a directory is a valid callback box.
 *
 * @param boxRoot - Directory to check
 * @returns Whether it's a valid box
 */
export async function isValidBox(boxRoot: string): Promise<boolean> {
  const markerPath = path.join(boxRoot, BOX_MARKER);
  try {
    await fs.access(markerPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get box metadata from the marker file.
 *
 * @param boxRoot - The box root directory
 * @returns Box metadata or null if not a valid box
 */
export async function getBoxMetadata(
  boxRoot: string
): Promise<{ version: string; created: string } | null> {
  const markerPath = path.join(boxRoot, BOX_MARKER);
  try {
    const content = await fs.readFile(markerPath, "utf-8");
    return JSON.parse(content) as { version: string; created: string };
  } catch {
    return null;
  }
}
