/** `bbx triage duplicates`: exact-duplicate inbox items; `--apply` trashes only the removable ones. */
import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { getBoxDir, requireBoxRoot } from "../../../lib/paths/core.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { applyDuplicateRemovals, findExactDuplicates } from "../../../core/triage/duplicates.js";
import { output, cliAction, withInheritedJson, type OutputOptions } from "./io.js";

/** Every file directly in `inbox/staged/`, as `runJevTriage` lists them. */
async function stagedRefs(boxRoot: string): Promise<string[]> {
  const staged = getBoxDir(boxRoot, "inboxStaged");
  let entries: Dirent[];
  try { entries = await fs.readdir(staged, { withFileTypes: true }); }
  catch (error) { if (errnoCode(error) !== "ENOENT") throw error; return []; }
  return entries.filter((entry) => !entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => `/${path.relative(boxRoot, path.join(staged, entry.name)).split(path.sep).join("/")}`).toSorted();
}

export function registerDuplicatesCommand(triageCommand: Command, reporting: (command: Command) => Command): void {
  reporting(triageCommand.command("duplicates [refs...]").description("Find exact-duplicate inbox items (default: inbox/staged); no model call")
    .option("--apply", "Move removable duplicates to trash, one scoped commit each; review ones never move"))
    .action((refs: string[], options: OutputOptions & { apply?: boolean }) => cliAction(async () => {
      const boxRoot = await requireBoxRoot();
      const findings = await findExactDuplicates(boxRoot, refs.length > 0 ? refs : await stagedRefs(boxRoot));
      const removals = options.apply === true ? await applyDuplicateRemovals(boxRoot, { findings }) : [];
      const lines = findings.map((finding) => `${finding.sourceRef}\t${finding.disposition}\t${[...new Set(finding.originals.map((original) => original.copyOf))].join(", ")}`);
      const tail = options.apply === true ? `Trashed ${String(removals.length)}.` : "Not applied; use --apply to trash removable ones.";
      await output({ findings, removals }, { ...withInheritedJson(triageCommand, options), summary: [`${String(findings.length)} duplicate(s). ${tail}`, ...lines].join("\n") });
    }));
}
