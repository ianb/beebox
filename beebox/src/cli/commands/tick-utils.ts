/**
 * Shared utilities for scheduled script execution.
 * Used by both `bbx tick` and `bbx wakeup`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  parseScheduledScript,
  ScheduledScriptSchema,
  type ParsedScheduledScript,
} from "../../schemas/scheduled-script/schema.js";
import { isDueForWakeup, isWithinBudget } from "../../schemas/scheduled-script/due.js";
import { cardFields, parseCardText } from "../../core/card-io.js";
import { errorMessage } from "../../lib/error-guards.js";
import { createCardSchemaMap } from "../../schemas.js";
import { checkMissingConnectors } from "../../requirements.js";
import {
  loadScriptState,
  saveScriptState,
  recordOutcome,
  acquireScriptLock,
  releaseScriptLock,
  loadRunningScripts,
  DEFAULT_RUN_WINDOW_MS,
} from "../../core/schedule/state.js";
import { checkRequiredConnectors, noteTickSkip, promoteDeferredRun } from "../../core/schedule/promotion.js";
import { fallbackTiming, runAndRecord } from "../../core/schedule/run-action.js";
import { parseCardName, getBoxDir } from "../../lib/paths/core.js";
import { resolveRefPath } from "../../shared/ref-path/core.js";
import { scheduleOutcomeLine } from "../../shared/schedule-error.js";
import { getDefaultTemplate } from "../../templates-registry.js";
import {
  boxEngineUnavailability,
  classifyScheduleFailure,
  engineWaitReason,
} from "../../core/schedule/engine-wait.js";
import { getBoxTime } from "../../lib/time.js";
import { stageAndCommitPaths } from "../../lib/git/core.js";

/**
 * Run all on-wakeup scheduled scripts that are due.
 * Returns the number of scripts that ran.
 */
export async function runOnWakeupScripts(boxRoot: string, now: Date): Promise<number> {
  const schedulesDir = getBoxDir(boxRoot, "schedules");

  let files: string[];
  try {
    files = (await fs.readdir(schedulesDir)).filter((f) =>
      f.endsWith(".scheduled-script.card")
    );
  } catch (_e) {
    // No schedules directory (box has none configured) — nothing to run
    return 0;
  }

  let ranCount = 0;
  const running = await loadRunningScripts(boxRoot);

  for (const file of files) {
    const scriptName = file.replace(".scheduled-script.card", "");
    const cardPath = path.join(schedulesDir, file);

    let parsed;
    try {
      const content = await fs.readFile(cardPath, "utf-8");
      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
      parsed = parseScheduledScript(cardFields(card, ScheduledScriptSchema));
    } catch (err) {
      console.error(`  Error parsing ${file}: ${errorMessage(err)}`);
      continue;
    }

    const state = await loadScriptState(boxRoot, scriptName);
    if (!isDueForWakeup(parsed, { lastRun: state.lastRun, now })) {
      continue;
    }

    // Engine unavailable (e.g. quota-exhausted): running would burn attempts
    // that cannot succeed. Re-checked per script — an earlier script in this
    // same pass may have just detected the episode. `lastRun` stays
    // untouched, so scripts stay due and run on the first wakeup after the
    // reset.
    // The promotion rule, as in `bbx tick`: a requested schedule that cannot run says so once.
    const promotion = { boxRoot, scriptName, parsed, state, now };
    const engineWait = await boxEngineUnavailability(boxRoot);
    if (engineWait !== null) {
      console.log(`  Skipping ${scriptName}: ${engineWaitReason(engineWait)}`);
      await noteTickSkip(promotion, { reason: "engine-quota", live: engineWait });
      continue;
    }

    // Requirements check
    if (parsed.requires) {
      const missing = await checkMissingConnectors(boxRoot, parsed.requires);
      if (missing.length > 0) {
        console.log(`  Skipping ${scriptName}: missing connectors: ${missing.join(", ")}`);
        await noteTickSkip(promotion, { reason: "missing-connectors", connectors: missing });
        continue;
      }
    }

    // Budget check
    if (parsed.budget) {
      const check = isWithinBudget(parsed.budget, { recentRuns: state.recentRuns, now });
      if (!check.allowed) {
        console.log(`  Skipping ${scriptName}: budget exceeded (${Math.round(check.usedMs / 1000)}s used)`);
        continue;
      }
    }

    // Lock-group check: skip if another script in the same group is already running
    if (parsed.lockGroup) {
      const conflict = [...running.entries()].find(
        ([name, lock]) => lock.lockGroup === parsed.lockGroup && name !== scriptName
      );
      if (conflict) {
        console.log(`  Skipping ${scriptName}: lock-group "${parsed.lockGroup}" held by ${conflict[0]}`);
        continue;
      }
    }

    await checkRequiredConnectors(promotion);
    console.log(`  Running ${scriptName}...`);
    const preRunMtimeMs = await cardMtimeMs(cardPath);
    await acquireScriptLock({ boxRoot, scriptName, triggeredBy: "wakeup", ...(parsed.lockGroup ? { lockGroup: parsed.lockGroup } : {}) });
    // This script's own span, not the pass's — the deferred classification
    // must not attribute an unavailability detected by an EARLIER script in
    // this pass to this script's unrelated failure.
    const scriptStartedAt = getBoxTime(boxRoot);
    try {
      const run = await runAndRecord({
        boxRoot, parsed, scriptName, triggeredBy: "wakeup", stdio: "inherit",
        state, now, runStartedAt: scriptStartedAt,
      });
      if (run.result === "success") {
        ranCount++;
        await handleCreateAfterSuccess({ boxRoot, parsed, scriptName });
        if (parsed.once && (await deleteOnceCard(cardPath, { file, preRunMtimeMs, quiet: false }))) {
          // Only the card's own path: the wakeup must not sweep other work into this commit.
          await stageAndCommitPaths(boxRoot, {
            paths: [path.relative(boxRoot, cardPath)],
            message: `Wakeup: remove one-shot ${scriptName}`,
            trailers: { "Triggered-By": "bbx wakeup" },
          });
        }
      } else if (run.deferReason !== undefined) {
        console.log(`  ${scheduleOutcomeLine(run)}`);
        await promoteDeferredRun(promotion);
      } else {
        console.error(`  ${scheduleOutcomeLine(run)}`);
      }
    } catch (err) {
      // Post-success housekeeping failed: the run is recorded again as its outcome.
      const { durationMs, sleepAffected } = fallbackTiming(err);
      const windowMs = parsed.budget?.windowMs ?? DEFAULT_RUN_WINDOW_MS;
      const outcome = await classifyScheduleFailure({ boxRoot, runStartedAt: scriptStartedAt, error: err });
      recordOutcome(state, { result: outcome.result, error: outcome.error, durationMs, sleepAffected, windowMs, now });
      await saveScriptState({ boxRoot, scriptName, state });
      console.error(`  ${scheduleOutcomeLine(outcome)}`);
    } finally {
      await releaseScriptLock({ boxRoot, scriptName });
    }
  }

  return ranCount;
}

/** A card's mtime before its run, so `deleteOnceCard` can tell a card the run rewrote; 0 when it is gone. */
export async function cardMtimeMs(cardPath: string): Promise<number> {
  try {
    return (await fs.stat(cardPath)).mtimeMs;
  } catch (_e) {
    // Deleted between readdir and here: 0 makes any later mtime read as a
    // recreation, which is the safe direction (keep the card).
    return 0;
  }
}

/**
 * `once`: delete the card after a run recorded `success` (never after a
 * deferral or failure) — unless the run recreated or rewrote it (e.g. archive
 * re-triggering), which leaves it for the next run. Shared by `bbx tick` and
 * `bbx wakeup`'s on-wakeup pass. Returns whether the card was deleted.
 */
export async function deleteOnceCard(
  cardPath: string,
  opts: { file: string; preRunMtimeMs: number; quiet: boolean },
): Promise<boolean> {
  const { file, preRunMtimeMs, quiet } = opts;
  try {
    const postStat = await fs.stat(cardPath);
    if (postStat.mtimeMs > preRunMtimeMs) {
      if (!quiet) console.log(`  One-shot script recreated during execution, keeping: ${file}`);
      return false;
    }
  } catch (_e) {
    // Already gone: the desired end state holds, and the stat failure carries
    // nothing actionable.
    return false;
  }
  await fs.unlink(cardPath);
  if (!quiet) console.log(`  Deleted one-shot script: ${file}`);
  return true;
}

/**
 * After a script succeeds, create any chained cards declared via <create-after-success>.
 * Skips if the target file already exists (idempotent).
 *
 * `chain.path` is card-authored data (a scheduled-script card, which an agent
 * may write), and this is a *write* path — so it goes through the shared ref
 * algebra as a `write-target`: leading `/` means the box root, `..` that climbs
 * out resolves to `null`, and an escaping entry is a logged error that skips
 * only that chain (matching the per-entry error posture of the rest of the loop).
 */
export async function handleCreateAfterSuccess(
  { boxRoot, parsed, scriptName }: { boxRoot: string; parsed: ParsedScheduledScript; scriptName: string },
): Promise<void> {
  for (const chain of parsed.createAfterSuccess) {
    const contained = resolveRefPath({ fromPath: undefined, ref: chain.path, kind: "write-target" });
    if (contained === null || contained === "") {
      console.error(`  Chain: ${scriptName}: path "${chain.path}" escapes the box — skipping`);
      continue;
    }
    const fullPath = path.join(boxRoot, contained);

    // Skip if already exists (idempotent)
    try {
      await fs.access(fullPath);
      console.log(`  Chain: ${chain.path} already exists, skipping`);
      continue;
    } catch (_e) {
      // access throws when the file doesn't exist — the expected case; proceed to create it
    }

    const basename = path.basename(contained);
    const cardName = parseCardName(basename);
    if (!cardName) {
      console.error(`  Chain: cannot parse card name from ${chain.path}`);
      continue;
    }

    const template = getDefaultTemplate(cardName.type);
    if (!template) {
      console.error(`  Chain: no default template for type "${cardName.type}"`);
      continue;
    }

    const parseResult = template.argsSchema.safeParse(chain.args);
    if (!parseResult.success) {
      console.error(`  Chain: invalid args for ${chain.path}: ${parseResult.error.message}`);
      continue;
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, template.generate(parseResult.data));
    console.log(`  Chain: created ${chain.path} (from ${scriptName})`);
  }
}
