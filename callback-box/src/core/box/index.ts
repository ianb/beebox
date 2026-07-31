/**
 * Box directory structure operations.
 *
 * Creates and manages the standard directory layout for a callback box.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BOX_DIRS, BOX_MARKER, boxPath } from "../../lib/paths.js";
import { initRepo, isRepo } from "../../lib/git.js";
import { getBoxShape } from "../../lib/box-shape.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { claudeProjectsRoot } from "../chat/session/transcript-paths.js";
import { MIGRATIONS } from "../migrations.js";
import { assetGitignorePatterns } from "../commands/attachments-gitignore.js";
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
    // Create the marker. Every box is shapeVersion 2 (the package layout): the
    // box root is a `content/` dir nested inside a package. A fresh v2 init
    // requires the package half to already exist (a parent `package.json`
    // declaring `callback-box`), so direct callers go through `scaffoldV2Box`
    // (`./package.js`), which lays that down first.
    const marker = {
      version: "1.0.0",
      shapeVersion: 2,
      created: getBoxTimeISO(resolvedRoot),
    };
    await fs.writeFile(markerPath, JSON.stringify(marker, null, 2) + "\n");
  }

  // Fail fast: validate the box is a well-formed v2 package (marker + parent
  // package.json declaring callback-box) BEFORE creating directories, the
  // migration manifest, config, or `.gitignore`. A missing/invalid package
  // half or a stale pre-v2 marker throws here, before any of those mutations
  // land — so a bad init can't leave a half-written box behind.
  await getBoxShape(resolvedRoot);

  // Create all standard directories (safe to re-run). `.claude`/`.claude/rules`
  // (BOX_DIRS) are never created under the box root: a box's `.claude/` lives at
  // the package root instead (generateRules/generateSkills/installValidationHooks
  // write it there), so `ensureDirectories` skips those two entries rather than
  // leaving a vestigial, always-empty `content/.claude/`.
  await ensureDirectories(resolvedRoot);

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

  // Always write .gitignore (keep in sync with cb version). A box's tricks live
  // at `packageRoot/src/tricks/`, outside `boxRoot` (`content/`) entirely, so no
  // trick-dependencies entry belongs here; that box's `src/tricks/node_modules/`
  // is already covered by the package root's own `.gitignore` (`ROOT_GITIGNORE`
  // in `./box-package.js`).
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

# Chat file uploads (transient, swept by cb wakeup housekeeping)
tmp/

# Temporary files
*.tmp
*.swp
*~

# cb-assets (managed by cb attachments init-gitignore)
# Assets inside .attach/ scopes are tracked via per-dir manifest.json
# (size + sha256), not committed directly. See docs/implemented-plans/asset-manifests.md.
${assetGitignorePatterns()}
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
 * `BOX_DIRS.claude`/`BOX_DIRS.rules` (`.claude/`, `.claude/rules/`) are always
 * skipped: a box's `.claude/` lives at the package root instead (see
 * `initBox`'s caller), so creating them under the box root would leave a
 * vestigial, always-empty `content/.claude/`.
 *
 * @param boxRoot - The box root directory
 */
export async function ensureDirectories(boxRoot: string): Promise<void> {
  const skip: Set<string> = new Set([BOX_DIRS.claude, BOX_DIRS.rules]);
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
  installTodoView,
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
  const { packageRoot } = await getBoxShape(resolvedRoot);
  const localMemoryDir = path.join(packageRoot, ".claude", "memory");
  const slug = resolvedRoot.replaceAll("/", "-");
  // `claudeProjectsRoot()` (src/core/chat/session/transcript-paths.ts) is the one shared
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
