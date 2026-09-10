/**
 * Box directory structure operations.
 *
 * Creates and manages the standard directory layout for a Bee Box.
 */
import { seedSystemCards, assertSystemCardsComplete } from "../system-cards.js";
import { REMAINING_SYSTEM_CARD_MIGRATION } from "../../shared/system-card-paths.js";


import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BOX_DIRS, BOX_MARKER, boxPath } from "../../lib/paths.js";
import { initRepo, isRepo } from "../../lib/git.js";
import { getBoxShape } from "../../lib/box-shape.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { claudeProjectsRoot, encodeProjectDir } from "../chat/session/transcript-paths.js";
import { MIGRATIONS } from "../migrations.js";
import { GITIGNORE_BLOCK, UNIGNORE_BLOCK } from "../commands/attachments-gitignore.js";
import { isAnnexInitialized } from "../annex/is-annex-box.js";
import { MIGRATED_SECTION_HEADER } from "../migrations/one-root-ignore-merge.js";
import {
  installSchemasGuide,
  installTricksFiles,
  installViewsGuide,
} from "./templates.js";
import { z } from "zod";
import { errnoCode } from "../../lib/error-guards.js";
import { migrateBoxState } from "../../lib/state-migration.js";

const BoxMarkerSchema = z.object({ version: z.string(), created: z.string() });

/**
 * Finding 4 (Track E hardening review, round 3): `initBox` regenerates
 * `.gitignore`/`.gitattributes` WHOLESALE on every call, not just the one
 * regen the one-root migration itself runs — a routine `bbx init` re-run
 * (chat start, wakeup, docs refresh) any time after `mergeIgnoreRules`
 * appended a box's migrated-forward custom rules under its marked section
 * silently discarded them again on the very next call. Preserve whatever's
 * under that marker (verbatim, to EOF) across the regeneration: read it
 * before overwriting, re-append it after — idempotent, since the marker is
 * re-extracted fresh each time rather than accumulated.
 */
async function readMigratedSection(filePath: string): Promise<string | null> {
  let current: string;
  try {
    current = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  const markerIndex = current.indexOf(MIGRATED_SECTION_HEADER);
  return markerIndex === -1 ? null : current.slice(markerIndex);
}

async function writeRegeneratedFilePreservingMigratedSection(filePath: string, regeneratedBody: string): Promise<void> {
  const migratedSection = await readMigratedSection(filePath);
  const content =
    migratedSection === null ? regeneratedBody : `${regeneratedBody.trimEnd()}\n\n${migratedSection.trimEnd()}\n`;
  await fs.writeFile(filePath, content);
}

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
 * Initialize a new Bee Box or update an existing one.
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
  await migrateBoxState(resolvedRoot);

  // Check if already initialized
  const markerPath = path.join(resolvedRoot, BOX_MARKER);
  const isUpdate = await isValidBox(resolvedRoot);

  if (!isUpdate) {
    // Create the marker. Every box is shapeVersion 3 (the one-root layout):
    // `package.json`, `src/`, and every `_`-prefixed operational area all
    // live at this same root. A fresh init requires the npm-package half to
    // already exist (`package.json` declaring `beebox`), so direct callers
    // go through `scaffoldBoxRoot` (`./package.js`), which lays that down
    // first.
    const marker = {
      version: "1.0.0",
      shapeVersion: 3,
      created: getBoxTimeISO(resolvedRoot),
    };
    await fs.mkdir(path.dirname(markerPath), { recursive: true });
    await fs.writeFile(markerPath, JSON.stringify(marker, null, 2) + "\n");
  }

  // Fail fast: validate the box is well-formed (marker + its own package.json
  // declaring beebox) BEFORE creating directories, the migration manifest,
  // config, or `.gitignore`. A missing/invalid package half or a stale
  // pre-v3 marker throws here, before any of those mutations land — so a bad
  // init can't leave a half-written box behind.
  const shape = await getBoxShape(resolvedRoot);
  if (!isUpdate) {
    try {
      await seedSystemCards(resolvedRoot, REMAINING_SYSTEM_CARD_MIGRATION);
    } catch (error) {
      // This invocation created the marker; a failed bootstrap must remain a fresh-init retry.
      await fs.rm(markerPath);
      throw error;
    }
  }

  // Which asset-tracking scheme is this box on? Every box starts on the
  // manifest scheme (gitignored asset bytes) and `bbx attachments to-annex`
  // moves it to git-annex (assets un-ignored). `.gitignore` is regenerated on
  // EVERY init, so writing the manifest form unconditionally silently
  // de-annexed any converted box on its next `bbx init` — assets ignored again
  // — with nothing reporting it until the first commit or asset write failed.
  // The probe is repo-level (`.git/annex/`), so it cannot be flipped by the
  // files this function writes. (`.gitattributes` no longer varies: LFS is
  // retired, so neither scheme gets filter rules.)
  const annexed = await isAnnexInitialized(shape.boxRoot);

  // Create all standard directories (safe to re-run). `.claude`/`.claude/rules`
  // (BOX_DIRS) are skipped: they're populated by generated files
  // (generateRules/generateSkills/installValidationHooks), not preserved as
  // empty dirs via `.gitkeep`.
  await ensureDirectories(resolvedRoot);

  // Seed the migration manifest for fresh boxes with every known migration
  // marked applied — a brand-new box's data is created in the current
  // format, so none of the historical data migrations need to run against
  // it. Future migrations added after init will show up as pending.
  // Already-initialized boxes never get one auto-created here: an existing
  // box without a manifest is a legacy box, and the user must explicitly
  // run `bbx migrate --mark-all-applied` (or --init) to decide its starting
  // state. See `src/cli/commands/migrate.ts`.
  if (!isUpdate) {
    await assertSystemCardsComplete(resolvedRoot, REMAINING_SYSTEM_CARD_MIGRATION);
    const manifestPath = path.join(resolvedRoot, "_config/migrations.jsonl");
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
  const transcriptionConfigPath = path.join(resolvedRoot, "_config/transcription.json");
  try {
    await fs.access(transcriptionConfigPath);
  } catch (_e) {
    // Config absent (fs.access throws ENOENT) — install the default. The
    // error carries no actionable info; absence is the normal install path.
    await fs.mkdir(path.join(resolvedRoot, "_config"), { recursive: true });
    await fs.writeFile(
      transcriptionConfigPath,
      JSON.stringify({ service: "voxtral" }, null, 2) + "\n"
    );
  }

  // Always write .gitattributes. Git LFS is retired: git-annex is the only
  // asset backend, so no box — annexed or not — gets `filter=lfs` rules any
  // more. Pre-annex boxes gitignore their asset bytes (GITIGNORE_BLOCK below),
  // so an LFS filter could never fire on them either; the rules were dead
  // config that only did harm, by re-LFS-ifying a converted box's new media if
  // the annex probe ever read false. What stays is the section headers, so the
  // file is byte-identical to what `bbx attachments to-annex` leaves behind and
  // re-running init is a no-op on every box. `stripLfsFilters` remains the
  // migration's tool for stripping rules off boxes that still carry them.
  await writeRegeneratedFilePreservingMigratedSection(
    path.join(resolvedRoot, ".gitattributes"),
    `# Audio files (voice memos, recordings)

# Images

# Frozen page captures
`,
  );

  await writeBoxGitignore(resolvedRoot, { annexed });

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
 * Write the box's `.gitignore` from the current rendering. `bbx init` calls
 * this on every run, and the `gitignore-2026-09` migration calls it once per
 * existing box: the 2026-08 rename changed the state directory and the lock
 * and pid names, and a box that kept its pre-rename file ignored nothing
 * current, so its next autocommit swept the whole state directory in.
 *
 * ONE root `.gitignore` covers both halves that used to be two files under
 * the two-root layout: the npm-package rules (`node_modules/`, trick deps —
 * formerly `ROOT_GITIGNORE` in `./package.js`) and the operational rules
 * (formerly written alone at the separate `content/` root). A box migrated
 * from v2 may carry a marked "Migrated local rules" section; the preserving
 * write keeps it across regeneration.
 *
 * The trailing asset block comes from `attachments-gitignore.ts` rather than
 * being spelled out here — the two must be identical, and an inlined copy is
 * what let `bbx init` keep writing the manifest-scheme block onto boxes that
 * had migrated to git-annex.
 */
export async function writeBoxGitignore(boxRoot: string, options: { annexed: boolean }): Promise<void> {
  const { annexed } = options;
  const gitignore = `# Bee Box .gitignore
# npm package
node_modules/

# Trick dependencies (installed by agent) -- see src/tricks/
src/tricks/node_modules/

# Lock files (every .bbx-*.lock: reactor, trick-commit, and whatever comes next)
.bbx-lock
.bbx-*.lock

# Local config (credentials, etc.)
_config/connectors/*.secret.*

# Transient connector state (timestamps, sync tokens — machine-local)
_bookkeeping/connectors/*.state.*

# Server PID file
.bbx-serve.pid

# Generated agent docs (regenerated by bbx init/reactor)
.beebox/
_content/docs/generated/

# Schedule state (machine-local)
_config/schedules/.state/

# Scratch space (transient, swept by bbx wakeup housekeeping)
_tmp/

# Temporary files
*.tmp
*.swp
*~

${annexed ? UNIGNORE_BLOCK : GITIGNORE_BLOCK}`;
  await writeRegeneratedFilePreservingMigratedSection(path.join(boxRoot, ".gitignore"), gitignore);
}

/**
 * Ensure all standard directories exist.
 *
 * `BOX_DIRS.claude`/`BOX_DIRS.rules` (`.claude/`, `.claude/rules/`) are
 * always skipped: they're populated by generated files
 * (generateRules/generateSkills/installValidationHooks), so pre-creating
 * them here would only leave a vestigial, always-empty directory ahead of
 * that.
 *
 * @param boxRoot - The box root directory
 */
async function ensureDirectories(boxRoot: string): Promise<void> {
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
 * Check if a directory is a valid Bee Box.
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
// here so `bbx init` and other callers can keep importing them from "./index.js".
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
 * Ensure `.claude/memory/` exists (at the box root — see "Where Claude Code
 * runs" in `docs/implemented-plans/boxes-as-packages-v2.md`) and symlink it
 * from `~/.claude/projects/<slug>/memory` so Claude Code's auto-memory is
 * stored inside the git-tracked box directory.
 *
 * Claude Code derives the project slug from the OPERATING cwd — the box
 * root, since that's where every agent session actually runs. We compute the
 * same slug and create a symlink from the global location to the box-local
 * directory.
 *
 * If memory files already exist in the global location, they are
 * moved into the box first.
 */
export async function symlinkClaudeMemory(boxRoot: string): Promise<boolean> {
  const resolvedRoot = path.resolve(boxRoot);
  const shape = await getBoxShape(resolvedRoot);
  const localMemoryDir = path.join(shape.boxRoot, ".claude", "memory");
  // `claudeProjectsRoot()` and `encodeProjectDir()` (src/core/chat/session/
  // transcript-paths.ts) are the one shared resolver + encoder for
  // `~/.claude/projects/<dir>`. The encoder collapses EVERY non-alphanumeric
  // character (not only `/`) — a box path with `_` or `.` in it, linked under a
  // `/`-only translation, lands in a directory Claude Code never reads, so its
  // auto-memory silently stays global. The root also honors
  // `BBX_CLAUDE_PROJECTS_DIR`, so doctests and the box-packageify smoke test
  // can point this at a fixture directory instead of the real global one.
  const globalMemoryDir = path.join(claudeProjectsRoot(), encodeProjectDir(resolvedRoot), "memory");

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
