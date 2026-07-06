/**
 * cb init - Initialize a new callback box
 *
 * When you change what `cb init` creates, installs, or generates, also
 * review docs/box-layout.md — that doc is the canonical developer
 * reference for the on-disk shape of a box, and it doesn't auto-generate
 * itself.
 */

import { Command } from "commander";
import { initBox, installProcedures, installGuides, installSchedules, installPersonality, installBriefing, installRootLandmark, symlinkClaudeMemory } from "../../core/box.js";
import { detectBoxTarget, scaffoldPackageRoot } from "../../core/box-package.js";
import { stageAll, commit, initRepo, isRepo } from "../../lib/git.js";
import { generateRules } from "../../core/init-rules.js";
import { generateSkills } from "../../core/box-skills.js";
import { generateDocs, setDocIdDebug } from "../../core/docs-gen/index.js";
import { installValidationHooks } from "../../core/install-validation-hooks.js";
import { openSearchIndex } from "../../core/search/refresh.js";

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
  // Detects what's already at `targetPath`: an existing legacy box (stays
  // legacy — conversion is a later migration, not init's job), an existing
  // v2 box (`content/` nested inside), or nothing yet. A fresh init always
  // scaffolds the v2 package layout — see "The box repository" in
  // docs/implemented-plans/boxes-as-packages-v2.md.
  const { mode, boxRoot, packageRoot } = await detectBoxTarget(targetPath);
  const isFresh = mode === "fresh";

  // `--skip-git` only skips git initialization/commit (handled below and in
  // announceAndInitGit) — the package scaffold (package.json, tsconfig.json,
  // CLAUDE.md, .gitignore) still needs to exist on a fresh init regardless,
  // or initBox's shapeVersion-2 check fails immediately after.
  if (isFresh) {
    await scaffoldPackageRoot(packageRoot);
  }

  // initBox always operates on the operational root (`boxRoot`) and
  // never touches git itself here — for a fresh v2 init, git's root is
  // the PACKAGE root, one level up, which we init explicitly below.
  const { isUpdate } = await initBox(boxRoot, {
    skipGit: true,
    branch: options.branch,
    shapeVersion: isFresh ? 2 : undefined,
  });

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
    console.log(`\nInstalled ${schedules.length} schedule(s) in config/schedules/ (disabled by default)`);
    console.log("  Enable by setting enabled=\"true\" after configuring connector secrets.");
    for (const s of schedules) {
      console.log(`  ${s}`);
    }
  }

  // Symlink .claude/memory/ so auto-memory is git-tracked
  const memoryLinked = await symlinkClaudeMemory(boxRoot);
  if (memoryLinked) {
    console.log("\nLinked .claude/memory/ → ~/.claude/projects/ (auto-memory now git-tracked)");
  }

  // Generate card-handling rules from schemas
  const generated = await generateRules(boxRoot);
  if (generated.length > 0) {
    console.log(`\nGenerated ${generated.length} card rules in .claude/rules/`);
  }

  // Install managed box skills (e.g. build-course)
  const skills = await generateSkills(boxRoot);
  if (skills.length > 0) {
    console.log(`Installed ${skills.length} skill(s) in .claude/skills/: ${skills.join(", ")}`);
  }

  // Set or clear the docid-debug marker
  if (options.docidDebug !== undefined) {
    await setDocIdDebug(boxRoot, options.docidDebug);
  }

  // Install/refresh validation hooks (.git/hooks/pre-commit and
  // .claude/settings.json PostToolUse entry) so the cb path embedded in
  // them matches THIS cb. generateDocs() also calls this, but it short-
  // circuits when its doc-gen cache says nothing changed — so re-running
  // `cb init` after switching cb sources (monorepo migration, new
  // worktree, etc.) wouldn't refresh the hooks via that path alone.
  await installValidationHooks(boxRoot);

  // Generate agent documentation (picks up docid-debug from marker file)
  await generateDocs(boxRoot);
  console.log("Generated agent docs in .callback-box/ and docs/generated/");

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
    console.log("\nRun 'cb status' to see the current state.");
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
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

