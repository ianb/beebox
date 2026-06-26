/**
 * cb init - Initialize a new callback box
 *
 * When you change what `cb init` creates, installs, or generates, also
 * review docs/box-layout.md — that doc is the canonical developer
 * reference for the on-disk shape of a box, and it doesn't auto-generate
 * itself.
 */

import { Command } from "commander";
import { resolve } from "node:path";
import { initBox, installProcedures, installGuides, installSchedules, installPersonality, installBriefing, installRootLandmark, symlinkClaudeMemory } from "../../core/box.js";
import { stageAll, commit } from "../lib/git.js";
import { generateRules } from "../../core/init-rules.js";
import { generateSkills } from "../../core/box-skills.js";
import { generateDocs, setDocIdDebug } from "../../core/generate-docs.js";
import { installValidationHooks } from "../../core/install-validation-hooks.js";
import { openSearchIndex } from "../../core/search/refresh.js";

export const initCommand = new Command("init")
  .description("Initialize or update a callback box")
  .argument("[path]", "Path to initialize", ".")
  .option("--skip-git", "Skip git initialization")
  .option("-b, --branch <name>", "Initial branch name", "main")
  .option("--docid-debug", "Add DOCID markers to generated docs (persists until --no-docid-debug)")
  .action(async (targetPath: string, options: { skipGit?: boolean; branch: string; docidDebug?: boolean }) => {
    try {
      const { isUpdate } = await initBox(targetPath, {
        skipGit: options.skipGit,
        branch: options.branch,
      });

      if (isUpdate) {
        console.log(`Updated callback box at ${resolve(targetPath)}`);
        console.log("  Ensured standard directories exist");
        console.log("  Updated .gitignore");
      } else {
        console.log(`Initialized callback box at ${targetPath}`);

        if (!options.skipGit) {
          console.log("Git repository initialized with initial commit.");
        }

        console.log("\nDirectory structure created:");
        console.log("  box/inbox/          - Incoming items");
        console.log("  box/inbox/unhandled - Items with no clear destination");
        console.log("  box/questions/      - Pending questions");
        console.log("  box/resources/      - Synced external state");
        console.log("  store/archive/      - Processed items");
        console.log("  store/integrated/   - Feedback absorbed into briefs");
        console.log("  store/trash/        - Soft-deleted items");
        console.log("  config/             - Configuration");
        console.log("  .claude/            - Agent configuration");
      }

      // Install procedure templates
      const procedures = await installProcedures(resolve(targetPath));
      if (procedures.length > 0) {
        console.log(`\nInstalled ${procedures.length} procedure(s) in config/procedures/`);
        for (const p of procedures) {
          console.log(`  ${p}`);
        }
      }

      // Install default guide cards
      const guides = await installGuides(resolve(targetPath));
      if (guides.length > 0) {
        console.log(`\nInstalled ${guides.length} guide(s) in config/`);
        for (const g of guides) {
          console.log(`  ${g}`);
        }
      }

      // Install personality card template
      const personalityInstalled = await installPersonality(resolve(targetPath));
      if (personalityInstalled) {
        console.log("\nInstalled config/main.personality.card");
      }

      // Install root briefing card
      const briefingInstalled = await installBriefing(resolve(targetPath));
      if (briefingInstalled) {
        console.log("\nInstalled briefing.briefing.card");
      }

      // Install the root landmark so the Landmarks page can offer
      // "chat scoped to the box root." Magical — refilled on wakeup
      // if the user deletes it.
      const rootLandmarkInstalled = await installRootLandmark(resolve(targetPath));
      if (rootLandmarkInstalled !== null) {
        // Fresh init commits everything below; a re-init refill is left for the
        // next wakeup to commit (see runHousekeeping).
        console.log("\nInstalled Box.landmark.card (edit to customize the root landmark)");
      }

      // Install default scheduled scripts
      const schedules = await installSchedules(resolve(targetPath));
      if (schedules.length > 0) {
        console.log(`\nInstalled ${schedules.length} schedule(s) in config/schedules/ (disabled by default)`);
        console.log("  Enable by setting enabled=\"true\" after configuring connector secrets.");
        for (const s of schedules) {
          console.log(`  ${s}`);
        }
      }

      // Symlink .claude/memory/ so auto-memory is git-tracked
      const memoryLinked = await symlinkClaudeMemory(resolve(targetPath));
      if (memoryLinked) {
        console.log("\nLinked .claude/memory/ → ~/.claude/projects/ (auto-memory now git-tracked)");
      }

      // Generate card-handling rules from schemas
      const generated = await generateRules(resolve(targetPath));
      if (generated.length > 0) {
        console.log(`\nGenerated ${generated.length} card rules in .claude/rules/`);
      }

      // Install managed box skills (e.g. build-course)
      const skills = await generateSkills(resolve(targetPath));
      if (skills.length > 0) {
        console.log(`Installed ${skills.length} skill(s) in .claude/skills/: ${skills.join(", ")}`);
      }

      // Set or clear the docid-debug marker
      if (options.docidDebug !== undefined) {
        await setDocIdDebug(resolve(targetPath), options.docidDebug);
      }

      // Install/refresh validation hooks (.git/hooks/pre-commit and
      // .claude/settings.json PostToolUse entry) so the cb path embedded in
      // them matches THIS cb. generateDocs() also calls this, but it short-
      // circuits when its doc-gen cache says nothing changed — so re-running
      // `cb init` after switching cb sources (monorepo migration, new
      // worktree, etc.) wouldn't refresh the hooks via that path alone.
      await installValidationHooks(resolve(targetPath));

      // Generate agent documentation (picks up docid-debug from marker file)
      await generateDocs(resolve(targetPath));
      console.log("Generated agent docs in .callback-box/ and docs/generated/");

      // Build the search index so the first `cb search` isn't a cold build.
      await openSearchIndex(resolve(targetPath), {
        onProgress: (message) => console.log(message),
      });
      console.log("Built search index in .callback-box/");
      if (options.docidDebug) {
        console.log("  DOCID markers enabled (grep for DOCID: in prompt logs to verify inclusion)");
      }

      // Commit everything (schedules, procedures, guides, rules, docs, etc.)
      // on fresh init — initBox() only creates the git repo without committing.
      if (!isUpdate && !options.skipGit) {
        const resolved = resolve(targetPath);
        await stageAll(resolved);
        await commit(resolved, {
          message: "Initialize callback box",
          trailers: {
            "Created-By": "cb init",
          },
        });
      }

      if (!isUpdate) {
        console.log("\nRun 'cb status' to see the current state.");
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

