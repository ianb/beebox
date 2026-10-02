/**
 * bbx changes — what changed in the box since a commit.
 *
 * Prints the box-relative paths added (or modified, or either) under the
 * `--match` globs between `--since` and HEAD, one per line. The comparison is
 * a tree diff (`getRangeChangedPaths`), so a card added and then moved by triage inside
 * the window appears once, at its final path. Inside a scheduled script
 * `--since` defaults to `$BBX_SINCE_COMMIT`, the schedule's own cursor (see
 * `core/schedule/memory.ts`); outside one, a missing `--since` is an error,
 * never a guess. See docs/implemented-plans/notifications.md (Track D).
 *
 * `--cat` prints each card after a `=== <path>` line; `--cat --all` prints
 * every matching card, changed or not. A card with a `body-file: { ref }`
 * sidecar (an email-message) is followed by a `--- body ---` line and the
 * sidecar's text, capped at 4,000 characters (`cli/lib/body-file-section.ts`). A `--match` glob
 * naming a card type the box does not know (`*.email.card`) warns on stderr,
 * since it can never match a real card. `--log` prints the commit subjects in
 * the window. `--or-skip` exits 75 (the procedure skip code) when nothing
 * changed, after writing `{ "reason": "no-change" }` to `$BBX_DEFER_FILE` when
 * that is set; with `--all` it still keys on whether anything changed.
 *
 * Exit codes: 0 printed; 75 nothing changed under `--or-skip`; 2 a usage
 * error; 1 a git error (an unknown `--since` commit).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths/core.js";
import { errnoCode, errorMessage } from "../../shared/error-guards.js";
import { getRangeChangedPaths, getRangeSubjects, getTreeFiles } from "../../lib/git-range.js";
import { CHECK_SKIP_CODE } from "../../core/procedure/shell.js";
import { MEMORY_ENV, writeDeferMarker } from "../../core/schedule/memory.js";
import { createCardSchemaMap } from "../../schemas.js";
import { bodyFileSection } from "../lib/body-file-section.js";

const KINDS = { added: "A", modified: "M", any: "AMR" } as const;
type Kind = keyof typeof KINDS;

export interface ChangesOptions {
  since?: string | undefined;
  match: string[];
  kind?: string | undefined;
  cat?: boolean | undefined;
  all?: boolean | undefined;
  log?: boolean | undefined;
  orSkip?: boolean | undefined;
}

function isKind(value: string): value is Kind {
  return Object.hasOwn(KINDS, value);
}

function matches(file: string, globs: readonly string[]): boolean {
  return globs.length === 0 || globs.some((glob) => path.posix.matchesGlob(file, glob));
}

/** A usage error (exit 2), or the validated since and kind. */
function checkOptions(options: ChangesOptions, env: NodeJS.ProcessEnv): string | { since: string; kind: Kind } {
  const kind = options.kind ?? "added";
  if (!isKind(kind)) return `--kind must be one of ${Object.keys(KINDS).join(", ")} (got "${kind}")`;
  if (options.all === true && options.cat !== true) return "--all applies only with --cat";
  if (options.log === true && options.cat === true) return "give --cat or --log, not both";
  const since = options.since ?? env[MEMORY_ENV.sinceCommit] ?? "";
  if (since.trim() === "") return "no since: pass --since or run from a schedule";
  return { since: since.trim(), kind };
}

/** Warn about each glob whose last segment names a card type (`*.<type>.card`) the box has no schema for. */
async function warnUnknownTypes(boxRoot: string, globs: readonly string[]): Promise<void> {
  const typed = globs.flatMap((glob) => {
    const type = /\.([\w-]+)\.card$/.exec(path.posix.basename(glob))?.[1];
    return type === undefined ? [] : [{ glob, type }];
  });
  if (typed.length === 0) return;
  const known = await createCardSchemaMap(boxRoot);
  for (const { glob, type } of typed) {
    if (!known.has(type)) console.error(`bbx changes: warning: --match ${glob} names card type "${type}", which this box has no schema for; it matches no cards`);
  }
}

async function printCards(boxRoot: string, files: readonly string[]): Promise<void> {
  for (const file of files) {
    let text: string;
    try {
      text = await fs.readFile(path.join(boxRoot, file), "utf-8");
    } catch (e) {
      // Committed at HEAD but gone from the working tree since: say so, keep going.
      if (errnoCode(e) !== "ENOENT") throw e;
      console.error(`bbx changes: ${file} is in HEAD but not on disk; skipped`);
      continue;
    }
    console.log(`=== ${file}`);
    console.log(text.replace(/\n$/, ""));
    const body = await bodyFileSection(boxRoot, { file, text });
    if (body !== null) console.log(body);
  }
}

/** The command with `boxRoot` and the environment given, returning the exit code. */
export async function runChanges(boxRoot: string, opts: { options: ChangesOptions; env: NodeJS.ProcessEnv }): Promise<number> {
  const { options, env } = opts;
  const checked = checkOptions(options, env);
  if (typeof checked === "string") {
    console.error(`Error: ${checked}`);
    return 2;
  }
  const { since, kind } = checked;
  await warnUnknownTypes(boxRoot, options.match);
  let changed: string[];
  try {
    const diff = await getRangeChangedPaths(boxRoot, { from: since, to: "HEAD", filter: KINDS[kind] });
    changed = diff.filter((file) => matches(file, options.match));
  } catch (e) {
    console.error(`Error: could not compare ${since} with HEAD: ${errorMessage(e)}`);
    return 1;
  }
  if (changed.length === 0 && options.orSkip === true) {
    const deferFile = env[MEMORY_ENV.deferFile];
    if (deferFile !== undefined && deferFile !== "") await writeDeferMarker(deferFile, "no-change");
    return CHECK_SKIP_CODE;
  }
  if (options.log === true) {
    for (const subject of await getRangeSubjects(boxRoot, { from: since, to: "HEAD" })) console.log(subject);
  } else if (options.cat === true) {
    const files = options.all === true ? (await getTreeFiles(boxRoot, { rev: "HEAD" })).filter((f) => matches(f, options.match)) : changed;
    await printCards(boxRoot, files);
  } else {
    for (const file of changed) console.log(file);
  }
  return 0;
}

export const changesCommand = new Command("changes")
  .description("List box paths added or modified since a commit (default: this schedule's last run)")
  .option("--since <commit>", "Compare from this commit (default: $BBX_SINCE_COMMIT, set inside a scheduled script)")
  .option("--match <glob>", "Only paths matching this box-relative glob (repeatable)", (value: string, previous: string[]) => [...previous, value], [])
  .option("--kind <kind>", "added, modified, or any", "added")
  .option("--cat", "Print each card in full after a `=== <path>` line instead of the bare path")
  .option("--all", "With --cat: print every card matching the globs, changed or not")
  .option("--log", "Print the commit subjects in the window instead of paths")
  .option("--or-skip", "Exit 75 when nothing changed, writing the reason to $BBX_DEFER_FILE when set")
  .action(async (options: ChangesOptions) => {
    try {
      const boxRoot = await requireBoxRoot();
      process.exit(await runChanges(boxRoot, { options, env: process.env }));
    } catch (e) {
      console.error(`Error: ${errorMessage(e)}`);
      process.exit(1);
    }
  });
