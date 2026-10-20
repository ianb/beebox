/**
 * Box directory structure operations.
 *
 * Creates and manages the standard directory layout for a Bee Box.
 */
import { seedSystemCards, assertSystemCardsComplete } from "../../system-cards.js";
import { REMAINING_SYSTEM_CARD_MIGRATION, SEARCH_SYSTEM_CARD_MIGRATION } from "../../../shared/system-card-paths.js";


import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BOX_DIRS, boxPath } from "../../../lib/paths/core.js";
import { BOX_MARKER, isBoxRoot, recordedShapeSource, writeShapeBlock } from "../../../lib/box-identity.js";
import { MissingShapeRecordError } from "../../../lib/box-shape-errors.js";
import { hasCommits, initRepo, isRepo } from "../../../lib/git/core/operations.js";
import { getBoxShape } from "../../../lib/box-shape.js";
import { getBoxTimeISO } from "../../../lib/time.js";
import { getSessionDir } from "../../chat/session/transcript-paths.js";
import { MIGRATIONS } from "../../migrations.js";
import { UNIGNORE_BLOCK } from "../../attachments-gitignore.js";
import { installTricksPackageJson } from "../templates.js";
import { syncBoxGuidance } from "../guidance-sync/core.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { migrateBoxState } from "../../../lib/state-migration.js";

/**
 * Header of the "Migrated local rules" section a v2→v3 conversion could leave
 * in a box `.gitignore`/`.gitattributes`.
 *
 * The migration that wrote it is deleted — every box is shapeVersion 3 and the
 * v2 population is empty — but boxes converted while it existed still carry the
 * section, and `bbx init` regenerates those files on every run. This marker is
 * what makes the regeneration preserve it instead of dropping a boxholder's
 * hand-kept rules.
 */
const MIGRATED_SECTION_HEADER = "# Migrated local rules (from the v2 box's .gitignore/.gitattributes)";

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

  // Already initialized when the box records its shape. A committed repo with
  // no record was initialized before and lost it — a clone of a box that has
  // not run `box-shape-record-2026-10` — so it is refused with a recovery
  // line, not re-initialized with a guessed version and birth date.
  const isUpdate = (await recordedShapeSource(resolvedRoot)) !== null;
  if (!isUpdate && (await isRepo(resolvedRoot)) && (await hasCommits(resolvedRoot))) {
    throw new MissingShapeRecordError(resolvedRoot);
  }

  if (!isUpdate) {
    // Record the shape in the tracked `package.json`, so a clone of this box
    // is a box. Every box is shapeVersion 3 (the one-root layout): a fresh
    // init requires the npm-package half to already exist (`package.json`
    // declaring `beebox`), so direct callers go through `scaffoldBoxRoot`
    // (`./package.js`), which lays that down first. `_config/` is the other
    // half of box identity (`isBoxRoot`).
    const created = getBoxTimeISO(resolvedRoot);
    await writeShapeBlock(resolvedRoot, { shapeVersion: 3, created });
    await fs.mkdir(path.join(resolvedRoot, BOX_DIRS.config), { recursive: true });
    // Transition only: also write the gitignored marker, in the shape older
    // engines read (they require `version` and `created`), so an engine from
    // before the block — a deploy rollback, or the main checkout's `bbx` run
    // by this box's git hooks — still sees a box. This engine never reads it
    // once the block exists. Removed with the marker fallback:
    // issues/deferred/2026-10-20-drop-box-marker-fallback.md.
    await fs.mkdir(path.join(resolvedRoot, path.dirname(BOX_MARKER)), { recursive: true });
    await fs.writeFile(path.join(resolvedRoot, BOX_MARKER), JSON.stringify({ version: "1.0.0", shapeVersion: 3, created }, null, 2) + "\n");
  }

  // Fail fast: validate the box is well-formed (recorded shape + its own
  // package.json declaring beebox) BEFORE creating directories, the
  // migration manifest, config, or `.gitignore`. A missing/invalid package
  // half or a stale pre-v3 record throws here, before any of those mutations
  // land — so a bad init can't leave a half-written box behind. Called for
  // that throw; the returned shape has no reader here.
  await getBoxShape(resolvedRoot);
  if (!isUpdate) {
    try {
      await seedSystemCards(resolvedRoot, REMAINING_SYSTEM_CARD_MIGRATION);
      await seedSystemCards(resolvedRoot, SEARCH_SYSTEM_CARD_MIGRATION);
    } catch (error) {
      // This invocation recorded the shape; a failed bootstrap must remain a fresh-init retry.
      await writeShapeBlock(resolvedRoot, null);
      await fs.rm(path.join(resolvedRoot, BOX_MARKER));
      throw error;
    }
  }

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
    await assertSystemCardsComplete(resolvedRoot, SEARCH_SYSTEM_CARD_MIGRATION);
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
  // asset backend, so no box gets `filter=lfs` rules any more. The rules were
  // dead config that only did harm, by re-LFS-ifying a box's new media if the
  // annex probe ever read false. What stays is the section headers, so the
  // file is byte-identical to what `bbx attachments to-annex` leaves behind and
  // re-running init is a no-op on every box. This regen is also what strips
  // the rules off a box that still carries them.
  await writeRegeneratedFilePreservingMigratedSection(
    path.join(resolvedRoot, ".gitattributes"),
    `# Audio files (voice memos, recordings)

# Images

# Frozen page captures
`,
  );

  await writeBoxGitignore(resolvedRoot);

  // Code scaffold, seeded once: the tricks package.json.
  await installTricksPackageJson(resolvedRoot);

  // Guidance: the same registry walk the generateDocs template sync runs,
  // minus the generators, which `bbx init` reaches through generateDocs.
  await syncBoxGuidance(resolvedRoot, { generators: false });

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
 * this on every run. A rendering change reaches existing boxes only through a
 * new dated migration (the retired `gitignore-2026-09` was the last).
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
 *
 * There is no longer a choice of block. Every box is annex-shaped, so assets
 * are always visible to git and the annex always holds their bytes. The
 * `annexed` probe this used to branch on is gone with the manifest scheme it
 * selected.
 */
async function writeBoxGitignore(boxRoot: string): Promise<void> {
  const gitignore = `# Bee Box .gitignore
# npm package
node_modules/

# Trick dependencies (installed by agent) -- see src/tricks/
src/tricks/node_modules/

# Publication project build output (regenerated by bbx pub prepare)
**/*.attach/project/dist/

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

${UNIGNORE_BLOCK}`;
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
 * Check if a directory is a valid Bee Box: a `package.json` declaring
 * `beebox` beside `_config/` (`isBoxRoot`). Tracked files only, so a clone
 * of a box is a box.
 *
 * @param boxRoot - Directory to check
 * @returns Whether it's a valid box
 */
export async function isValidBox(boxRoot: string): Promise<boolean> {
  return isBoxRoot(boxRoot);
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
export { installRootQuestion } from "./root-question.js";

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
  // `getSessionDir()` (src/core/chat/session/transcript-paths.ts) is the one
  // shared resolver + encoder for `~/.claude/projects/<dir>`. It encodes the
  // cwd as Claude Code sees it — symlinks resolved, EVERY non-alphanumeric
  // character (not only `/`) collapsed to `-` — so a box path with `_`, `.`,
  // or a symlink in it is linked where Claude Code reads its memory. The root
  // honors `BBX_CLAUDE_PROJECTS_DIR`, so tests and the box-packageify smoke
  // test can point this at a fixture directory instead of the real global one.
  const globalMemoryDir = path.join(getSessionDir(resolvedRoot), "memory");

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

  // Move any existing memory files from global to local. A file that cannot
  // move (the box already has one by that name, or the rename fails, e.g.
  // EXDEV across filesystems) stays where it is, and so does its directory:
  // both copies are memory someone wrote, and which one wins is the
  // boxholder's call.
  const globalStat = await fs.lstat(globalMemoryDir).catch((e: unknown) => {
    if (errnoCode(e) === "ENOENT") return null; // first-time case: nothing to move
    throw e;
  });
  if (globalStat?.isDirectory() && !globalStat.isSymbolicLink()) {
    const kept: string[] = [];
    for (const file of await fs.readdir(globalMemoryDir)) {
      const src = path.join(globalMemoryDir, file);
      const dest = path.join(localMemoryDir, file);
      const destExists = await fs.access(dest).then(
        () => true,
        (e: unknown) => errnoCode(e) !== "ENOENT",
      );
      if (destExists) {
        kept.push(`${file} (the box has one)`);
        continue;
      }
      try {
        await fs.rename(src, dest);
      } catch (e) {
        kept.push(`${file} (${errnoCode(e) ?? String(e)})`);
      }
    }
    if (kept.length > 0) {
      console.warn(
        `Not linking ${globalMemoryDir} to ${localMemoryDir}; kept ${kept.join(", ")}. Merge them into the box copy and remove the global directory, then re-run init.`,
      );
      return false;
    }
    // Not recursive: a file written after the readdir above makes this fail
    // (ENOTEMPTY) instead of deleting it.
    try {
      await fs.rmdir(globalMemoryDir);
    } catch (e) {
      console.warn(`Not linking ${globalMemoryDir} to ${localMemoryDir}; it was not empty after the move (${errnoCode(e) ?? String(e)}). Re-run init.`);
      return false;
    }
  }

  // Ensure parent directory for symlink exists
  await fs.mkdir(path.dirname(globalMemoryDir), { recursive: true });

  // Remove whatever's at the global path (stale symlink, stray file, empty
  // dir). `force` makes absence fine; a directory needs `rmdir`, which is not
  // recursive, so one that filled up since the move above is left alone.
  try {
    await fs.rm(globalMemoryDir, { force: true });
  } catch (_e) {
    // `rm` without `recursive` refuses a directory.
    try {
      await fs.rmdir(globalMemoryDir);
    } catch (e) {
      console.warn(`Not linking ${globalMemoryDir} to ${localMemoryDir}; could not clear it (${errnoCode(e) ?? String(e)}). Re-run init.`);
      return false;
    }
  }

  // Create symlink: global → local
  await fs.symlink(localMemoryDir, globalMemoryDir);
  return true;
}
