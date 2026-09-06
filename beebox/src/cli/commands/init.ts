/**
 * bbx init - Initialize a new Bee Box
 *
 * When you change what `bbx init` creates, installs, or generates, also
 * review docs/box-layout.md — that doc is the canonical developer
 * reference for the on-disk shape of a box, and it doesn't auto-generate
 * itself.
 */

import { Command } from "commander";
import { initBox, installProcedures, installGuides, installSchedules, installPersonality, installBriefing, installTodoView, installRootLandmark, symlinkClaudeMemory } from "../../core/box/index.js";
import { detectBoxTarget, scaffoldBoxRoot } from "../../core/box/package.js";
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
 * Print the fresh-init banner and initialize git at the box root. Split out of
 * the action purely to keep its cyclomatic complexity down — this is all one
 * linear sequence, just long.
 *
 * A re-init prints nothing here: "ensured the directories exist" and "updated
 * .gitignore" are the steps running, not news. `runInit` reports what actually
 * changed instead.
 */
async function announceAndInitGit(
  { boxRoot, options }: {
    boxRoot: string;
    options: { skipGit?: boolean; branch: string };
  }
): Promise<void> {
  console.log(`Initialized Bee Box at ${boxRoot}`);

  if (!options.skipGit) {
    const alreadyRepo = await isRepo(boxRoot);
    if (!alreadyRepo) {
      await initRepo(boxRoot, options.branch);
    }
    console.log("Git repository initialized with initial commit.");
  }

  console.log("\nDirectory structure created:");
  console.log("  package.json, tsconfig.json, src/   - Box code (schemas, views, tricks)");
  console.log("  _content/inbox/                      - Incoming items");
  console.log("  _content/inbox/unhandled              - Items with no clear destination");
  console.log("  _bookkeeping/questions/               - Pending questions");
  console.log("  _bookkeeping/resources/               - Synced external state");
  console.log("  _bookkeeping/archive/                 - Processed items");
  console.log("  _bookkeeping/trash/                   - Soft-deleted items");
  console.log("  _config/                              - Configuration");
  console.log("  .claude/                              - Agent configuration");
}

export interface InitOptions {
  skipGit?: boolean;
  branch: string;
  docidDebug?: boolean;
}

/**
 * The `bbx init` action body, split out of `.action()` so it's callable
 * directly from tests without going through Commander's argv parsing or the
 * process.exit(1)-on-error wrapper below.
 */
export async function runInit(targetPath: string, options: InitOptions): Promise<void> {
  // Detects what's already at `targetPath`: an existing box (marker at the
  // target itself) or nothing yet. A fresh init always scaffolds the
  // one-root layout — see `docs/implemented-plans/one-root-box-layout.md`.
  const { mode, boxRoot } = await detectBoxTarget(targetPath);
  const isFresh = mode === "fresh";

  // A fresh init scaffolds the whole box (npm-package half + operational
  // half, both at the same root) via the shared builder — `scaffoldBoxRoot`
  // runs `scaffoldPackageRoot` then `initBox`, with the `node_modules/beebox`
  // symlink (deps) for native schema/view resolution. It deliberately skips
  // git (initialized explicitly below) and `bbx init`'s card installers (run
  // below). An existing box just re-runs `initBox` in place.
  if (isFresh) {
    await scaffoldBoxRoot(boxRoot, { deps: true });
    await announceAndInitGit({ boxRoot, options });
  } else {
    await initBox(boxRoot, { skipGit: true, branch: options.branch });
  }

  // What CHANGED, gathered rather than printed as it happens. A fresh init
  // flushes this after its banner, where the whole list is the point. A re-init
  // that changed nothing prints nothing at all — the repo's rule is that
  // routine success is silent, and re-init is a step every scripted path runs
  // (`deploy/add-box.sh` runs it twice to provision one box). A re-init that
  // DID change something still needs to say which box, so the header is
  // printed with the list or not at all.
  const changes: string[] = [];

  // Install procedure templates
  const procedures = await installProcedures(boxRoot);
  if (procedures.length > 0) {
    changes.push(`Installed ${procedures.length} procedure(s) in _config/procedures/`);
    for (const p of procedures) changes.push(`  ${p}`);
  }

  // Install default guide cards
  const guides = await installGuides(boxRoot);
  if (guides.length > 0) {
    changes.push(`Installed ${guides.length} guide(s) in _config/`);
    for (const g of guides) changes.push(`  ${g}`);
  }

  // Install personality card template
  const personalityInstalled = await installPersonality(boxRoot);
  if (personalityInstalled) changes.push("Installed _config/main.personality.card");

  // Install root briefing card
  const briefingInstalled = await installBriefing(boxRoot);
  if (briefingInstalled) changes.push("Installed _content/briefing.briefing.card");

  // Install the box-wide todo-view stock instance ("the plate")
  const todoViewInstalled = await installTodoView(boxRoot);
  if (todoViewInstalled) changes.push("Installed _content/plate.todo-view.card");

  // Install the root landmark so the Landmarks page can offer
  // "chat scoped to the box root." Magical — refilled on wakeup
  // if the user deletes it.
  const rootLandmarkInstalled = await installRootLandmark(boxRoot);
  if (rootLandmarkInstalled !== null) {
    // Fresh init commits everything below; a re-init refill is left for the
    // next wakeup to commit (see runHousekeeping).
    changes.push(`Installed ${rootLandmarkInstalled} (edit to customize the root landmark)`);
  }

  // Install default scheduled scripts
  const schedules = await installSchedules(boxRoot);
  if (schedules.length > 0) {
    changes.push(`Installed ${schedules.length} schedule(s) in _config/schedules/ (map refresh and run cleanup enabled; other seeds disabled)`);
    changes.push("  refresh-maps may invoke an efficient-tier agent when directory structure changes, including a full map build on a fresh box.");
    changes.push("  Enable an opt-in schedule in the dashboard or by setting enabled: true after reviewing it and configuring any required connector secrets.");
    for (const s of schedules) changes.push(`  ${s}`);
  }

  // Symlink .claude/memory/ so auto-memory is git-tracked
  const memoryLinked = await symlinkClaudeMemory(boxRoot);
  if (memoryLinked) changes.push("Linked .claude/memory/ → ~/.claude/projects/ (auto-memory now git-tracked)");

  // A fresh init prints its list here, in step order, so the slow generate/
  // index progress below still reads as progress rather than arriving before
  // the things it follows. A re-init cannot: it has to know whether the list is
  // empty before deciding to print a header at all, so it flushes at the end.
  if (isFresh && changes.length > 0) {
    console.log(changes.join("\n"));
    changes.length = 0;
  }

  // Set or clear the docid-debug marker
  if (options.docidDebug !== undefined) {
    await setDocIdDebug(boxRoot, options.docidDebug);
  }

  // Install/refresh validation hooks (.git/hooks/pre-commit and
  // .claude/settings.json PostToolUse entry) so the bbx path embedded in
  // them matches THIS bbx. generateDocs() also calls this (and init now forces
  // it past the doc-gen cache, so that call does fire) — but the hooks are
  // wanted whether or not doc generation later throws, and the helper is
  // idempotent.
  await installValidationHooks(boxRoot);

  // Bring git-annex configuration up to spec, repairing what it can.
  //
  // This belongs in the lifecycle, not only in an explicit `bbx doctor annex`
  // run: a box that is annex-uninitialized, has a stale `annex.largefiles`, or
  // (most likely) picked up git-annex's default `annex.thin` on clone is a box
  // whose commits are not protected and whose fsck cannot detect corruption —
  // and nothing else would say so. Repairs are logged; unfixable conditions are
  // reported but do not abort init, since the rest of the setup is still worth
  // doing and `bbx health` gates on them.
  const boxShape = await getBoxShape(boxRoot);
  const annexResult = await runAnnexDoctor(createGitAnnexService(), {
    repoRoot: boxShape.boxRoot,
    boxRoot,
  });
  for (const check of annexResult.checks) {
    if (check.status === "repaired") console.log(`git-annex: ${check.message}`);
    if (check.status === "failed") console.warn(`git-annex: ${check.message}`);
  }

  // Generate agent documentation (picks up docid-debug from marker file).
  // This is also where card rules (`generateRules`) and the managed box skills
  // (`generateSkills`) are written — `syncTemplatesFromSource` owns both, so
  // `bbx init` no longer calls them itself and there is one path that keeps a
  // box's generated artifacts current.
  //
  // Forced: generateDocs is cache-gated on input mtimes + the running engine's
  // version, and `bbx init` is the explicit "converge this box" hammer a human
  // reaches for precisely when they suspect the cache is lying. Before rules
  // and skills moved onto this path, init's own direct calls gave that
  // guarantee; `force` is what preserves it.
  await generateDocs(boxRoot, { force: true });
  if (isFresh) {
    console.log("Generated the agent guide in .beebox/, box-compiled docs in _content/docs/generated/, card rules in .claude/rules/, and box skills in .claude/skills/ (beebox reference docs: node_modules/beebox/box-docs/)");
  }

  // Build the search index so the first `bbx search` isn't a cold build. The
  // progress line fires only on a first build (`core/search/refresh.ts`), which
  // is the one case slow enough to be worth announcing; a refresh over an
  // existing index says nothing.
  await openSearchIndex(boxRoot, {
    onProgress: (message) => console.log(message),
  });
  if (options.docidDebug) {
    changes.push("DOCID markers enabled (grep for DOCID: in prompt logs to verify inclusion)");
  }

  // The re-init flush: the list is the entire output, and the header only earns
  // its line when there is a list under it. Nothing changed ⇒ nothing printed.
  if (changes.length > 0) {
    console.log(`Updated Bee Box at ${boxRoot}`);
    console.log(changes.join("\n"));
  }

  // Commit everything (package scaffold, schedules, procedures, guides,
  // rules, docs, etc.) on fresh init, at the box root — that's the git
  // root. Re-inits never hit this; the boxholder commits their own review
  // of what `bbx init` changed.
  if (isFresh && !options.skipGit) {
    await stageAll(boxRoot);
    await commit(boxRoot, {
      message: "Initialize Bee Box",
      trailers: {
        "Created-By": "bbx init",
      },
    });
  }

  if (isFresh) {
    // Point at the thing to open, not at another CLI command: the box is a web
    // app, and a fresh box's chat now opens with suggested questions to start
    // from. `bbx serve` prints the box's URL on startup.
    console.log(`\nNext: run 'bbx serve' and open the ${boxSlugFromShape(boxShape)} URL it prints.`);
  }
}

export const initCommand = new Command("init")
  .description("Initialize or update a Bee Box")
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
