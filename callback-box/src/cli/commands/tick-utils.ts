/**
 * Shared utilities for scheduled script execution.
 * Used by both `cb tick` and `cb wakeup`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  parseScheduledScript,
  isDueForWakeup,
  isWithinBudget,
  ScheduledScriptSchema,
  type ParsedScheduledScript,
} from "../../schemas/scheduled-script.js";
import { cardFields, parseCardText } from "../../core/card-io.js";
import { errorMessage } from "../../lib/error-guards.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { checkMissingConnectors } from "../../connectors/requirements.js";
import {
  loadScriptState,
  saveScriptState,
  recordOutcome,
  acquireScriptLock,
  releaseScriptLock,
  loadRunningScripts,
  DEFAULT_RUN_WINDOW_MS,
} from "../../core/schedule/state.js";
import {
  execWithTimeout,
  CommandError,
  SCRIPT_TIMEOUT,
  type ExecTiming,
} from "../../lib/exec-with-timeout.js";
import { parseCardName } from "../../lib/paths.js";
import { resolveRefPath } from "../../shared/ref-path.js";
import { getDefaultTemplate } from "../../schemas/templates.js";
import { buildToolingScriptEnv } from "../../core/script-env.js";

/** Timing for a run that failed outside execWithTimeout (e.g. spawn error):
 * no measurement exists, so record zero rather than invent one. */
export function fallbackTiming(err: unknown): ExecTiming {
  if (err instanceof CommandError) return err.timing;
  return { durationMs: 0, sleepAffected: false };
}

/**
 * Run all on-wakeup scheduled scripts that are due.
 * Returns the number of scripts that ran.
 */
export async function runOnWakeupScripts(boxRoot: string, now: Date): Promise<number> {
  const schedulesDir = path.join(boxRoot, "config/schedules");

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

    // Requirements check
    if (parsed.requires) {
      const missing = await checkMissingConnectors(boxRoot, parsed.requires);
      if (missing.length > 0) {
        console.log(`  Skipping ${scriptName}: missing connectors: ${missing.join(", ")}`);
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

    console.log(`  Running ${scriptName}...`);
    await acquireScriptLock({ boxRoot, scriptName, triggeredBy: "wakeup", ...(parsed.lockGroup ? { lockGroup: parsed.lockGroup } : {}) });
    const windowMs = parsed.budget?.windowMs ?? DEFAULT_RUN_WINDOW_MS;
    try {
      // Tooling profile: on-wakeup `runs:` commands are box tooling (mostly
      // `cb` invocations that sync connectors).
      const scriptEnv = await buildToolingScriptEnv(boxRoot, {
        CB_TRIGGERED_BY: "wakeup",
      });
      const { durationMs, sleepAffected } = await execWithTimeout(parsed.runs, {
        cwd: boxRoot,
        stdio: "inherit",
        timeout: parsed.timeoutMs ?? SCRIPT_TIMEOUT,
        env: scriptEnv,
      });

      recordOutcome(state, { result: "success", error: null, durationMs, sleepAffected, windowMs, now });
      await saveScriptState({ boxRoot, scriptName, state });
      ranCount++;

      await handleCreateAfterSuccess({ boxRoot, parsed, scriptName });
    } catch (err) {
      const { durationMs, sleepAffected } = fallbackTiming(err);

      recordOutcome(state, { result: "failure", error: errorMessage(err), durationMs, sleepAffected, windowMs, now });
      await saveScriptState({ boxRoot, scriptName, state });
      console.error(`  Failed: ${errorMessage(err)}`);
    } finally {
      await releaseScriptLock({ boxRoot, scriptName });
    }
  }

  return ranCount;
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
