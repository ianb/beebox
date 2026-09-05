/**
 * bbx status - Show current state summary
 */

import { Command } from "commander";
import { getSystemState, type CardInfo } from "../../core/state.js";
import {
  listParkedTemplateUpdates,
  PARKED_TEMPLATE_RESOLUTION,
  TEMPLATE_UPDATES_DIR,
} from "../../core/install-template-file.js";
import { requireBoxRoot } from "../../lib/paths.js";
import { getBoxShape, findLegacySchemaFiles, describeLegacySchemaFiles } from "../../lib/box-shape.js";
import { checkBoxRoot } from "../../lib/box-root-check.js";
import { loadBoxSchemas } from "../../schemas/registry.js";
import { listSchemaLoadFailures } from "../../schemas/schema-load-status.js";
import { getEngineVersionReport } from "../../core/engine-version.js";
import { errorMessage } from "../../lib/error-guards.js";

export const statusCommand = new Command("status")
  .description("Show current state summary")
  .option("-v, --verbose", "Show more details")
  .action(async (options: { verbose?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const state = await getSystemState(boxRoot);

      // Header
      console.log(`Bee Box: ${boxRoot}`);
      console.log(`Version: ${state.boxVersion}`);

      // Engine version: the process serving this box vs. the version a v2
      // box has pinned in its own node_modules (null/legacy for shapeVersion
      // 1, which has no separate installed engine). A mismatch is
      // future-normal once the hub serves per-box engines (Track D) — for
      // now it's just flagged, same treatment as parked template drift below.
      const engineVersions = await getEngineVersionReport(boxRoot);
      if (engineVersions.installed !== null) {
        console.log(`Engine: serving ${engineVersions.serving ?? "unknown"}, box pins ${engineVersions.installed}`);
        if (engineVersions.mismatch) {
          console.log("  MISMATCH: this box is running under a different engine version than it has pinned.");
        }
      }
      console.log();

      // Git status
      if (state.git.clean) {
        console.log("Git: clean");
      } else {
        console.log("Git: uncommitted changes");
        if (options.verbose) {
          if (state.git.staged.length > 0) {
            console.log(`  Staged: ${state.git.staged.length}`);
          }
          if (state.git.modified.length > 0) {
            console.log(`  Modified: ${state.git.modified.length}`);
          }
          if (state.git.untracked.length > 0) {
            console.log(`  Untracked: ${state.git.untracked.length}`);
          }
        }
      }
      console.log();

      // Inbox
      console.log(`Inbox: ${state.inbox.length} item(s)`);
      if (state.inbox.length > 0 && options.verbose) {
        printCards(state.inbox);
      }

      // Questions
      const pending = state.questions.filter(q => q.status === "pending");
      const answered = state.questions.filter(q => q.status === "answered");
      console.log(`Questions: ${pending.length} pending, ${answered.length} answered`);
      if (pending.length > 0 && options.verbose) {
        printCards(pending);
      }

      // Template drift: stock templates whose upstream update is parked because
      // the box copy diverged (boxholder-edited, or a version not yet in the
      // template's priorStockHashes). Surfaced so drift doesn't stay invisible.
      const parkedTemplates = await listParkedTemplateUpdates(boxRoot);
      if (parkedTemplates.length > 0) {
        console.log(`Template updates: ${parkedTemplates.length} parked (in ${TEMPLATE_UPDATES_DIR}/)`);
        if (options.verbose) {
          for (const relPath of parkedTemplates) {
            console.log(`  - ${relPath}`);
          }
          console.log(`  ${PARKED_TEMPLATE_RESOLUTION}`);
        }
      }

      // Box-local schema load failures: keep-last-good means a broken save
      // doesn't blank the type, but the failure itself needs to be seen.
      // loadBoxSchemas populates listSchemaLoadFailures for THIS process, so
      // trigger a load before reading it — a fresh `bbx status` invocation
      // otherwise starts with an empty in-memory map.
      await loadBoxSchemas(boxRoot);
      const schemaFailures = listSchemaLoadFailures(boxRoot);
      if (schemaFailures.length > 0) {
        console.log(`Schema load failures: ${schemaFailures.length}`);
        if (options.verbose) {
          for (const failure of schemaFailures) {
            console.log(`  - ${failure.file}: ${failure.message}`);
          }
        }
      }

      // Legacy schema path: stray *.ts files under _config/schemas/ (the
      // pre-src/schemas/ location) — invisible to the loader and to the
      // validate hook, so call it out explicitly.
      const shape = await getBoxShape(boxRoot);
      const legacySchemaFiles = await findLegacySchemaFiles(shape);
      if (legacySchemaFiles.length > 0) {
        console.log(describeLegacySchemaFiles(shape, legacySchemaFiles));
      }

      // Closed-vocabulary root check (Track C, `docs/plans/one-root-box-layout.md`):
      // a warning here, an error in `bbx validate` — status surfaces drift
      // without blocking, validate is the gate.
      await printRootStrays(boxRoot);

      // Recent activity
      if (options.verbose && state.recentActivity.length > 0) {
        console.log();
        console.log("Recent activity:");
        for (const entry of state.recentActivity.slice(0, 5)) {
          const date = new Date(entry.date).toLocaleString();
          console.log(`  ${date}: ${entry.subject}`);
        }
      }
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });

/** The `bbx status` warnings section for `checkBoxRoot` — see its call site above. */
async function printRootStrays(boxRoot: string): Promise<void> {
  const rootStrays = await checkBoxRoot(boxRoot);
  if (rootStrays.length === 0) return;
  console.log(`Box root: ${rootStrays.length} unexpected entr${rootStrays.length === 1 ? "y" : "ies"}`);
  for (const stray of rootStrays) {
    console.log(`  - ${stray.message}`);
  }
}

function printCards(cards: CardInfo[]): void {
  for (const card of cards) {
    const status = card.status ? ` [${card.status}]` : "";
    console.log(`  - ${card.relativePath}${status}`);
  }
}
