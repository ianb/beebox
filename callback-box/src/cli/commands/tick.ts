/**
 * cb tick - Evaluate and run due scheduled scripts.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { getBoxTime } from "../../lib/time.js";
import {
  parseScheduledScript,
  ScheduledScriptSchema,
} from "../../schemas/scheduled-script.js";
import { cardFields, parseCardText } from "../../core/card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { loadScriptState, loadRunningScripts } from "../../core/schedule/state.js";
import {
  readScheduleFiles,
  findBusyBlockers,
  effectiveBusyBlockers,
  evaluateSkip,
  executeScript,
} from "./tick-helpers.js";

export interface TickOptions {
  dryRun?: boolean;
  script?: string;
  /** When true, capture subprocess output instead of inheriting stdio */
  quiet?: boolean;
  /** Run the script named by `script` even if it isn't due, its budget is
   * spent, or a chat session is active (a forced run often originates from
   * chat). Liveness gates still apply: a live lock-group holder and running
   * scripts/procedures defer even under force. */
  force?: boolean;
}

export interface ScriptResult {
  name: string;
  status: "ran" | "skipped" | "error";
  command?: string;
  durationMs?: number;
  error?: string;
}

export interface TickResult {
  ranCount: number;
  skipCount: number;
  errorCount: number;
  scripts: ScriptResult[];
}

export async function runTick(boxRoot: string, options: TickOptions): Promise<TickResult> {
  const schedulesDir = path.join(boxRoot, "config/schedules");
  const now = getBoxTime(boxRoot);

  const readFiles = await readScheduleFiles(schedulesDir, options);
  if (readFiles === null) {
    return { ranCount: 0, skipCount: 0, errorCount: 0, scripts: [] };
  }
  let files = readFiles;

  if (options.script) {
    files = files.filter(
      (f) => f.replace(".scheduled-script.card", "") === options.script
    );
    if (files.length === 0) {
      console.error(`Script not found: ${options.script}`);
      process.exit(1);
    }
  }

  let ranCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  const scripts: ScriptResult[] = [];

  // Load currently running scripts for lock-group conflict detection
  const running = await loadRunningScripts(boxRoot);

  // Bail out if anything else is in flight (see findBusyBlockers). Under
  // --force, active chats don't defer (see effectiveBusyBlockers); the
  // housekeeping-commit hazard they guarded is handled at the commit site.
  const blockers = effectiveBusyBlockers(
    await findBusyBlockers(boxRoot, running),
    { force: options.force === true },
  );
  if (blockers.length > 0) {
    if (!options.quiet) {
      const hint = blockers.every((b) => b.startsWith("chat:"))
        ? " (cb tick --script <name> --force runs despite an active chat)"
        : "";
      console.log(`Tick deferred — system busy: ${blockers.join(", ")}${hint}`);
    }
    return { ranCount: 0, skipCount: files.length, errorCount: 0, scripts: [] };
  }

  for (const file of files) {
    const scriptName = file.replace(".scheduled-script.card", "");
    const cardPath = path.join(schedulesDir, file);

    let parsed;
    try {
      const content = await fs.readFile(cardPath, "utf-8");
      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
      parsed = parseScheduledScript(cardFields(card, ScheduledScriptSchema));
    } catch (err) {
      if (!options.quiet) console.error(`  Error parsing ${file}: ${(err as Error).message}`);
      errorCount++;
      scripts.push({ name: scriptName, status: "error", error: `parse: ${(err as Error).message}` });
      continue;
    }

    const state = await loadScriptState(boxRoot, scriptName);
    const skipReason = await evaluateSkip({ boxRoot, parsed, scriptName, state, now, running, options });
    if (skipReason !== null) {
      if (skipReason) console.log(skipReason);
      skipCount++;
      scripts.push({ name: scriptName, status: "skipped" });
      continue;
    }

    if (options.dryRun) {
      if (!options.quiet) console.log(`Would run: ${scriptName} → ${parsed.runs}`);
      ranCount++;
      scripts.push({ name: scriptName, status: "ran", command: parsed.runs });
      continue;
    }

    const result = await executeScript({ boxRoot, parsed, scriptName, cardPath, file, state, now, options });
    scripts.push(result);
    if (result.status === "ran") ranCount++;
    else errorCount++;
  }

  if (!options.quiet) {
    if (options.dryRun) {
      console.log(`\n${ranCount} script(s) would run, ${skipCount} not due.`);
    } else {
      console.log(
        `\nTick complete: ${ranCount} ran, ${skipCount} skipped, ${errorCount} errors.`
      );
    }
  }

  return { ranCount, skipCount, errorCount, scripts };
}

export const tickCommand = new Command("tick")
  .description("Evaluate and run due scheduled scripts")
  .option("--dry-run", "Show what would run without executing")
  .option("--script <name>", "Only evaluate a specific script (by filename stem)")
  .option("--force", "Run the --script now, bypassing schedule, budget, and active-chat checks")
  .option("--box <path>", "Box root path (defaults to current directory)")
  .action(async (options: TickOptions & { box?: string }) => {
    if (options.force && !options.script) {
      console.error("--force requires --script <name>");
      process.exit(1);
    }
    const boxRoot = options.box ?? await requireBoxRoot();
    await runTick(boxRoot, options);
  });
