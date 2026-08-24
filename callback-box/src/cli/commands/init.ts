/**
 * cb init - Initialize a new callback box
 *
 * When you change what `cb init` creates, installs, or generates, also
 * review docs/box-layout.md — that doc is the canonical developer
 * reference for the on-disk shape of a box, and it doesn't auto-generate
 * itself.
 */

import { Command } from "commander";
import { initBox, installProcedures, installGuides, installSchedules, installPersonality, installBriefing, installTodoView, installRootLandmark, symlinkClaudeMemory } from "../../core/box/index.js";
import { detectBoxTarget, scaffoldV2Box } from "../../core/box/package.js";
import { stageAll, commit, initRepo, isRepo } from "../../lib/git.js";
import { generateDocs, setDocIdDebug } from "../../core/docs-gen/index.js";
import { installValidationHooks } from "../../core/install-validation-hooks.js";
import { runAnnexDoctor } from "../../core/annex/doctor.js";
import { getBoxShape } from "../../lib/box-shape.js";
import { boxSlugFromShape } from "../../lib/box-slug.js";
import { createGitAnnexService } from "../../services/git-annex.js";
import { openSearchIndex } from "../../core/search/refresh.js";
import { errorMessage } from "../../lib/error-guards.js";

/**
 * Print the "what just happened" banner and (for a fresh init) initialize
 * git at the package root. Split out of the action purely to keep its
 * cyclomatic complexity down — this is all one linear sequence, just long.
 */
async function announceAndInitGit(
  { isFresh, isUpdate, boxRoot, packageRoot, options }: {
    isFresh: boolean;
    isUpdate: boolean;
    boxRoot: string;
    packageRoot: string;
    options: { skipGit?: boolean; branch: string };
  }
): Promise<void> {
  if (!isFresh && isUpdate) {
    console.log(`Updated callback box at ${boxRoot}`);
    console.log("  Ensured standard directories exist");
    console.log("  Updated .gitignore");
    return;
  }

  console.log(`Initialized callback box package at ${packageRoot}`);
  console.log(`  Operational box: ${boxRoot}`);

  if (!options.skipGit) {
    const alreadyRepo = await isRepo(packageRoot);
    if (!alreadyRepo) {
      await initRepo(packageRoot, options.branch);
    }
    console.log("Git repository initialized with initial commit.");
  }

  console.log("\nDirectory structure created:");
  console.log("  package.json, tsconfig.json  - Coding-session package (src/)");
  console.log("  content/box/inbox/            - Incoming items");
  console.log("  content/box/inbox/unhandled   - Items with no clear destination");
  console.log("  content/box/questions/        - Pending questions");
  console.log("  content/box/resources/        - Synced external state");
  console.log("  content/store/archive/        - Processed items");
  console.log("  content/store/trash/          - Soft-deleted items");
  console.log("  content/config/               - Configuration");
  console.log("  .claude/                      - Agent configuration (package root)");
}

export interface InitOptions {
  skipGit?: boolean;
  branch: string;
  docidDebug?: boolean;
}

/**
 * The `cb init` action body, split out of `.action()` so it's callable
 * directly from tests without going through Commander's argv parsing or the
 * process.exit(1)-on-error wrapper below.
 */
export async function runInit(targetPath: string, options: InitOptions): Promise<void> {
  // Detects what's already at `targetPath`: an existing v2 box (addressed by
  // its operational `content/` root or by its package root), or nothing yet.
  // A fresh init always scaffolds the v2 package layout — see "The box
  // repository" in docs/implemented-plans/boxes-as-packages-v2.md.
  const { mode, boxRoot, packageRoot } = await detectBoxTarget(targetPath);
  const isFresh = mode === "fresh";

  // A fresh init scaffolds the whole v2 box (package half + operational box at
  // `content/`) via the shared builder — `scaffoldV2Box` runs
  // `scaffoldPackageRoot` then `initBox({shapeVersion:2})`, with the
  // `node_modules/callback-box` symlink (deps) for native schema/view
  // resolution. It deliberately skips git (the PACKAGE root is the git root,
  // one level up, initialized explicitly below) and `cb init`'s card
  // installers (run below). An existing box (legacy or v2) just re-runs
  // `initBox` in place.
  let isUpdate: boolean;
  if (isFresh) {
    await scaffoldV2Box(packageRoot, { deps: true });
    isUpdate = false;
  } else {
    ({ isUpdate } = await initBox(boxRoot, { skipGit: true, branch: options.branch }));
  }

  await announceAndInitGit({ isFresh, isUpdate, boxRoot, packageRoot, options });

  // Install procedure templates
  const procedures = await installProcedures(boxRoot);
  if (procedures.length > 0) {
    console.log(`\nInstalled ${procedures.length} procedure(s) in config/procedures/`);
    for (const p of procedures) {
      console.log(`  ${p}`);
    }
  }

  // Install default guide cards
  const guides = await installGuides(boxRoot);
  if (guides.length > 0) {
    console.log(`\nInstalled ${guides.length} guide(s) in config/`);
    for (const g of guides) {
      console.log(`  ${g}`);
    }
  }

  // Install personality card template
  const personalityInstalled = await installPersonality(boxRoot);
  if (personalityInstalled) {
    console.log("\nInstalled config/main.personality.card");
  }

  // Install root briefing card
  const briefingInstalled = await installBriefing(boxRoot);
  if (briefingInstalled) {
    console.log("\nInstalled briefing.briefing.card");
  }

  // Install the box-wide todo-view stock instance ("the plate")
  const todoViewInstalled = await installTodoView(boxRoot);
  if (todoViewInstalled) {
    console.log("\nInstalled store/plate.todo-view.card");
  }

  // Install the root landmark so the Landmarks page can offer
  // "chat scoped to the box root." Magical — refilled on wakeup
  // if the user deletes it.
  const rootLandmarkInstalled = await installRootLandmark(boxRoot);
  if (rootLandmarkInstalled !== null) {
    // Fresh init commits everything below; a re-init refill is left for the
    // next wakeup to commit (see runHousekeeping).
    console.log("\nInstalled Box.landmark.card (edit to customize the root landmark)");
  }

  // Install default scheduled scripts
  const schedules = await installSchedules(boxRoot);
  if (schedules.length > 0) {
    console.log(`\nInstalled ${schedules.length} schedule(s) in config/schedules/ (map refresh and run cleanup enabled; other seeds disabled)`);
    console.log("  refresh-maps may invoke an efficient-tier agent when directory structure changes, including a full map build on a fresh box.");
    console.log("  Enable an opt-in schedule in the dashboard or by setting enabled: true after reviewing it and configuring any required connector secrets.");
    for (const s of schedules) {
      console.log(`  ${s}`);
    }
  }

  // Symlink .claude/memory/ so auto-memory is git-tracked
  const memoryLinked = await symlinkClaudeMemory(boxRoot);
  if (memoryLinked) {
    console.log("\nLinked .claude/memory/ → ~/.claude/projects/ (auto-memory now git-tracked)");
  }

  // Set or clear the docid-debug marker
  if (options.docidDebug !== undefined) {
    await setDocIdDebug(boxRoot, options.docidDebug);
  }

  // Install/refresh validation hooks (.git/hooks/pre-commit and
  // .claude/settings.json PostToolUse entry) so the cb path embedded in
  // them matches THIS cb. generateDocs() also calls this (and init now forces
  // it past the doc-gen cache, so that call does fire) — but the hooks are
  // wanted whether or not doc generation later throws, and the helper is
  // idempotent.
  await installValidationHooks(boxRoot);

  // Bring git-annex configuration up to spec, repairing what it can.
  //
  // This belongs in the lifecycle, not only in an explicit `cb doctor annex`
  // run: a box that is annex-uninitialized, has a stale `annex.largefiles`, or
  // (most likely) picked up git-annex's default `annex.thin` on clone is a box
  // whose commits are not protected and whose fsck cannot detect corruption —
  // and nothing else would say so. Repairs are logged; unfixable conditions are
  // reported but do not abort init, since the rest of the setup is still worth
  // doing and `cb health` gates on them.
  const boxShape = await getBoxShape(boxRoot);
  const annexResult = await runAnnexDoctor(createGitAnnexService(), {
    repoRoot: boxShape.packageRoot,
    boxRoot,
  });
  for (const check of annexResult.checks) {
    if (check.status === "repaired") console.log(`git-annex: ${check.message}`);
    if (check.status === "failed") console.warn(`git-annex: ${check.message}`);
  }

  // Generate agent documentation (picks up docid-debug from marker file).
  // This is also where card rules (`generateRules`) and the managed box skills
  // (`generateSkills`) are written — `syncTemplatesFromSource` owns both, so
  // `cb init` no longer calls them itself and there is one path that keeps a
  // box's generated artifacts current.
  //
  // Forced: generateDocs is cache-gated on input mtimes + the running engine's
  // version, and `cb init` is the explicit "converge this box" hammer a human
  // reaches for precisely when they suspect the cache is lying. Before rules
  // and skills moved onto this path, init's own direct calls gave that
  // guarantee; `force` is what preserves it.
  await generateDocs(boxRoot, { force: true });
  console.log("Generated agent docs in .callback-box/ and docs/generated/, card rules in .claude/rules/, and box skills in .claude/skills/");

  // Build the search index so the first `cb search` isn't a cold build.
  await openSearchIndex(boxRoot, {
    onProgress: (message) => console.log(message),
  });
  console.log("Built search index in .callback-box/");
  if (options.docidDebug) {
    console.log("  DOCID markers enabled (grep for DOCID: in prompt logs to verify inclusion)");
  }

  // Commit everything (package scaffold, schedules, procedures, guides,
  // rules, docs, etc.) on fresh init, at the PACKAGE root — that's the
  // git root for a v2 box. Re-inits (both legacy and v2) never hit this;
  // the boxholder commits their own review of what `cb init` changed.
  if (isFresh && !options.skipGit) {
    await stageAll(packageRoot);
    await commit(packageRoot, {
      message: "Initialize callback box",
      trailers: {
        "Created-By": "cb init",
      },
    });
  }

  if (isFresh) {
    // Point at the thing to open, not at another CLI command: the box is a web
    // app, and a fresh box's chat now opens with suggested questions to start
    // from. `cb serve` prints the box's URL on startup.
    console.log(`\nNext: run 'cb serve' and open the ${boxSlugFromShape(boxShape)} URL it prints.`);
  }
}

export const initCommand = new Command("init")
  .description("Initialize or update a callback box")
  .argument("[path]", "Path to initialize", ".")
  .option("--skip-git", "Skip git initialization")
  .option("-b, --branch <name>", "Initial branch name", "main")
  .option("--docid-debug", "Add DOCID markers to generated docs (persists until --no-docid-debug)")
  .action(async (targetPath: string, options: InitOptions) => {
    try {
      await runInit(targetPath, options);
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });
