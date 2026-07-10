/**
 * Box directory structure operations.
 *
 * Creates and manages the standard directory layout for a callback box.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BOX_DIRS, BOX_MARKER, boxPath } from "../../lib/paths.js";
import { initRepo, isRepo } from "../../lib/git.js";
import { getBoxShapeOrLegacyFallback } from "../../lib/box-shape.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { claudeProjectsRoot } from "../../cli/lib/session.js";
import { MIGRATIONS } from "../migrations.js";
import {
  installSchemasGuide,
  installTricksFiles,
  installViewsGuide,
} from "./templates.js";
import { z } from "zod";
import { errnoCode } from "../../lib/error-guards.js";

const BoxMarkerSchema = z.object({ version: z.string(), created: z.string() });

export interface InitOptions {
  /** Skip git initialization */
  skipGit?: boolean | undefined;
  /** Initial branch name */
  branch?: string | undefined;
  /**
   * The `.cb-box` marker's `shapeVersion` to write on a fresh init. Defaults
   * to 1 (legacy: `boxRoot` doubles as the package root) — every direct
   * caller of `initBox` (test fixtures, connector doctests, `cb init` on an
   * existing legacy box) wants that unless it's specifically scaffolding a
   * v2 package layout. `cb init` on a genuinely new path passes 2; see
   * `../core/box-package.js` `scaffoldPackageRoot`, which lays down the
   * package half this marker's shape then depends on.
   */
  shapeVersion?: number | undefined;
}

export interface InitResult {
  /** Whether this was a fresh init or an update of an existing box */
  isUpdate: boolean;
}

/**
 * Initialize a new callback box or update an existing one.
 *
 * On a fresh init: creates directories, marker, .gitignore, git repo, initial commit.
 * On an existing box: ensures directories exist, updates .gitignore.
 *
 * @param boxRoot - Directory to initialize (will be created if needed)
 * @param options - Initialization options
 */
export async function initBox(boxRoot: string, options?: InitOptions): Promise<InitResult> {
  options = options ?? {};
  const resolvedRoot = path.resolve(boxRoot);

  // Create root directory if needed
  await fs.mkdir(resolvedRoot, { recursive: true });

  // Check if already initialized
  const markerPath = path.join(resolvedRoot, BOX_MARKER);
  const isUpdate = await isValidBox(resolvedRoot);

  if (!isUpdate) {
    // Create marker file with metadata. Callers that don't care about the
    // package layout (nearly everyone — test fixtures, connector doctests,
    // `cb init` refreshing an existing legacy box) get shapeVersion 1
    // (legacy: box root === package root) by default; `cb init` on a
    // genuinely new path passes shapeVersion 2 alongside scaffolding the
    // package half (see `./box-package.js`).
    const marker = {
      version: "1.0.0",
      shapeVersion: options.shapeVersion ?? 1,
      created: getBoxTimeISO(resolvedRoot),
    };
    await fs.writeFile(markerPath, JSON.stringify(marker, null, 2) + "\n");
  }

  // Create all standard directories (safe to re-run). Written after the
  // marker so a fresh v2 box's shape is already on disk: `.claude`/
  // `.claude/rules` (BOX_DIRS) only belong under a legacy box's root — a v2
  // box's `.claude/` lives at the package root instead (generateRules/
  // generateSkills/installValidationHooks write it there), so those two
  // entries are skipped here for a v2 box rather than leaving a vestigial,
  // always-empty `content/.claude/`.
  const shape = await getBoxShapeOrLegacyFallback(resolvedRoot);
  await ensureDirectories(resolvedRoot, { skipClaudeDir: shape.shapeVersion !== 1 });

  // Seed the migration manifest for fresh boxes with every known migration
  // marked applied — a brand-new box's data is created in the current
  // format, so none of the historical data migrations need to run against
  // it. Future migrations added after init will show up as pending.
  // Already-initialized boxes never get one auto-created here: an existing
  // box without a manifest is a legacy box, and the user must explicitly
  // run `cb migrate --mark-all-applied` (or --init) to decide its starting
  // state. See `src/cli/commands/migrate.ts`.
  if (!isUpdate) {
    const manifestPath = path.join(resolvedRoot, "config/migrations.jsonl");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    try {
      await fs.access(manifestPath);
    } catch (_e) {
      // No manifest yet (fs.access throws ENOENT) — seed one. The error
      // carries no actionable info; absence is the normal create path.
      const now = getBoxTimeISO(resolvedRoot);
      const lines = MIGRATIONS
        .map((m) => `${JSON.stringify({ name: m.name, "applied-at": now })}\n`)
        .join("");
      await fs.writeFile(manifestPath, lines);
    }
  }

  // Install default transcription config if missing
  const transcriptionConfigPath = path.join(resolvedRoot, "config/transcription.json");
  try {
    await fs.access(transcriptionConfigPath);
  } catch (_e) {
    // Config absent (fs.access throws ENOENT) — install the default. The
    // error carries no actionable info; absence is the normal install path.
    await fs.mkdir(path.join(resolvedRoot, "config"), { recursive: true });
    await fs.writeFile(
      transcriptionConfigPath,
      JSON.stringify({ service: "voxtral" }, null, 2) + "\n"
    );
  }

  // Always write .gitattributes (LFS rules for binary files)
  const gitattributes = `# Audio files (voice memos, recordings)
*.m4a filter=lfs diff=lfs merge=lfs -text
*.webm filter=lfs diff=lfs merge=lfs -text
*.wav filter=lfs diff=lfs merge=lfs -text
*.mp3 filter=lfs diff=lfs merge=lfs -text
*.ogg filter=lfs diff=lfs merge=lfs -text

# Images
*.jpg filter=lfs diff=lfs merge=lfs -text
*.jpeg filter=lfs diff=lfs merge=lfs -text
*.png filter=lfs diff=lfs merge=lfs -text
*.heic filter=lfs diff=lfs merge=lfs -text

# Frozen page captures
*.frozen filter=lfs diff=lfs merge=lfs -text
`;
  await fs.writeFile(path.join(resolvedRoot, ".gitattributes"), gitattributes);

  // Always write .gitignore (keep in sync with cb version). The "trick
  // dependencies" entry only applies to a legacy (v1) box, whose tricks live
  // at `boxRoot/tricks/` — inside this very .gitignore's tree. A v2 box's
  // tricks live at `packageRoot/src/tricks/`, outside `boxRoot` (`content/`)
  // entirely, so an entry here would never match anything; that box's
  // `src/tricks/node_modules/` is already covered by the package root's own
  // `.gitignore` (`ROOT_GITIGNORE` in `./box-package.js`).
  const tricksGitignoreBlock =
    shape.shapeVersion === 1
      ? `
# Trick dependencies (installed by agent)
tricks/node_modules/
`
      : "";
  const gitignore = `# Callback Box .gitignore
# Lock files
.cb-lock
.cb-reactor.lock

# Local config (credentials, etc.)
config/connectors/*.secret.*

# Transient connector state (timestamps, sync tokens — machine-local)
config/connectors/*.state.*

# Server PID file
.cb-serve.pid

# Generated agent docs (regenerated by cb init/reactor)
.callback-box/
docs/generated/

# Schedule state (machine-local)
config/schedules/.state/
${tricksGitignoreBlock}
# Chat file uploads (transient, swept by cb wakeup housekeeping)
tmp/

# Temporary files
*.tmp
*.swp
*~

# cb-assets (managed by cb attachments init-gitignore)
# Assets inside .attach/ scopes are tracked via per-dir manifest.json
# (size + sha256), not committed directly. See docs/asset-manifests.md.
**/*.attach/**/*.jpg
**/*.attach/**/*.jpeg
**/*.attach/**/*.png
**/*.attach/**/*.webp
**/*.attach/**/*.avif
**/*.attach/**/*.heic
**/*.attach/**/*.tif
**/*.attach/**/*.tiff
**/*.attach/**/*.gif
**/*.attach/**/*.webm
**/*.attach/**/*.mp3
**/*.attach/**/*.m4a
**/*.attach/**/*.wav
**/*.attach/**/*.pdf
**/*.attach/**/*.mp4
**/*.attach/**/*.mov
`;
  await fs.writeFile(path.join(resolvedRoot, ".gitignore"), gitignore);

  // Install tricks types.d.ts and CLAUDE.md if missing
  await installTricksFiles(resolvedRoot);

  // Install schemas guide CLAUDE.md if missing
  await installSchemasGuide(resolvedRoot);

  // Install views CLAUDE.md if missing
  await installViewsGuide(resolvedRoot);

  // Initialize git repo (only on fresh init) — don't commit yet;
  // the init command installs more files (schedules, procedures, etc.)
  // after this returns and commits everything together.
  if (!options.skipGit && !isUpdate) {
    const isExistingRepo = await isRepo(resolvedRoot);
    if (!isExistingRepo) {
      await initRepo(resolvedRoot, options.branch ?? "main");
    }
  }

  return { isUpdate };
}

/**
 * Ensure all standard directories exist.
 *
 * @param boxRoot - The box root directory
 * @param options.skipClaudeDir - Skip `BOX_DIRS.claude`/`BOX_DIRS.rules`
 *   (`.claude/`, `.claude/rules/`) — set for a v2 box, whose `.claude/` lives
 *   at the package root instead (see `initBox`'s caller).
 */
export async function ensureDirectories(
  boxRoot: string,
  options?: { skipClaudeDir?: boolean }
): Promise<void> {
  const skip: Set<string> = options?.skipClaudeDir
    ? new Set([BOX_DIRS.claude, BOX_DIRS.rules])
    : new Set();
  const dirs = Object.values(BOX_DIRS).filter((dir) => !skip.has(dir));

  for (const dir of dirs) {
    const fullPath = boxPath(boxRoot, dir);
    await fs.mkdir(fullPath, { recursive: true });

    // Create .gitkeep to preserve empty directories
    const gitkeep = path.join(fullPath, ".gitkeep");
    try {
      await fs.access(gitkeep);
    } catch (_e) {
      // No .gitkeep yet (fs.access throws ENOENT) — create it. The error
      // carries no actionable info; absence is the normal create path.
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
  } catch (_e) {
    // No marker file (fs.access throws ENOENT) — that is precisely what
    // "not a valid box" means. The error carries no actionable info.
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
    return BoxMarkerSchema.parse(JSON.parse(content));
  } catch (e) {
    // Missing marker is the normal "not a box" case; a malformed marker is
    // worth surfacing. Either way we report no metadata, but log so a
    // corrupt marker doesn't vanish silently.
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Could not read box marker at ${markerPath}:`, e);
    }
    return null;
  }
}

// Default-card installers (procedures, guides, personality, landmark,
// briefing, scheduled scripts) live in ./box-defaults and are re-exported
// here so `cb init` and other callers can keep importing them from "./index.js".
export {
  installProcedures,
  installGuides,
  installPersonality,
  installRootLandmark,
  installBriefing,
  installSchedules,
} from "./defaults.js";

/**
 * Ensure `.claude/memory/` exists (at the box's package root — `.claude/`
 * lives there, not in `content/`; see "Where Claude Code runs" in
 * `docs/implemented-plans/boxes-as-packages-v2.md`) and symlink it from
 * `~/.claude/projects/<slug>/memory` so Claude Code's auto-memory is stored
 * inside the git-tracked project directory.
 *
 * Claude Code derives the project slug from the OPERATING cwd — the box
 * root (`boxRoot`; `content/` for a v2 box, since that's where every agent
 * session actually runs), not the package root. We compute the same slug
 * and create a symlink from the global location to the package-root-local
 * directory.
 *
 * If memory files already exist in the global location, they are
 * moved into the box first.
 */
export async function symlinkClaudeMemory(boxRoot: string): Promise<boolean> {
  const resolvedRoot = path.resolve(boxRoot);
  const { packageRoot } = await getBoxShapeOrLegacyFallback(resolvedRoot);
  const localMemoryDir = path.join(packageRoot, ".claude", "memory");
  const slug = resolvedRoot.replaceAll("/", "-");
  // `claudeProjectsRoot()` (src/cli/lib/session.ts) is the one shared
  // resolver for `~/.claude/projects` — it also honors
  // `CB_CLAUDE_PROJECTS_DIR`, so doctests and the box-packageify smoke test
  // can point this at a fixture directory instead of the real global one.
  const globalMemoryDir = path.join(claudeProjectsRoot(), slug, "memory");

  // Check if the global path is already a symlink pointing here
  try {
    const stat = await fs.lstat(globalMemoryDir);
    if (stat.isSymbolicLink()) {
      const target = await fs.readlink(globalMemoryDir);
      if (path.resolve(target) === localMemoryDir) {
        return false; // Already set up
      }
    }
  } catch (_e) {
    // lstat throws ENOENT when the global path doesn't exist yet — the
    // normal first-time case. The error carries no actionable info; we
    // fall through to create the symlink below.
  }

  // Ensure local .claude/memory/ exists
  await fs.mkdir(localMemoryDir, { recursive: true });

  // Move any existing memory files from global to local
  try {
    const stat = await fs.lstat(globalMemoryDir);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      const files = await fs.readdir(globalMemoryDir);
      for (const file of files) {
        const src = path.join(globalMemoryDir, file);
        const dest = path.join(localMemoryDir, file);
        try {
          await fs.access(dest);
          // Local file already exists — skip (don't overwrite)
        } catch (_e) {
          // fs.access throws ENOENT when dest is absent — the normal case
          // for moving a file in. The error carries no actionable info.
          await fs.rename(src, dest);
        }
      }
      await fs.rm(globalMemoryDir, { recursive: true });
    }
  } catch (_e) {
    // lstat throws ENOENT when the global dir doesn't exist — nothing to
    // move. The error carries no actionable info; absence is expected.
  }

  // Ensure parent directory for symlink exists
  await fs.mkdir(path.dirname(globalMemoryDir), { recursive: true });

  // Remove whatever's at the global path (stale symlink, empty dir, etc.)
  try {
    await fs.rm(globalMemoryDir, { recursive: true });
  } catch (_e) {
    // Nothing at the global path to clear before symlinking. The error
    // carries no actionable info; absence is the expected, fine case.
  }

  // Create symlink: global → local
  await fs.symlink(localMemoryDir, globalMemoryDir);
  return true;
}
