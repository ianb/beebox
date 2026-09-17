#!/usr/bin/env tsx
/**
 * `schedule-engine-verbs-2026-09` — re-point scheduled scripts at `bbx engine`.
 *
 * The CLI split into the box agent's surface and everything else
 * (`src/cli/surface-data.ts`): verbs an agent can never call moved under
 * `bbx engine`. `wakeup` is one of them, and every box's stock schedule cards
 * carry it as a literal shell string — `runs: bbx wakeup --connector gmail` and
 * its calendar, drive, capture, raindrop, and dropbox siblings. The scheduler
 * executes that string through a shell (`cli/commands/tick-utils.ts`), so an
 * unmigrated card runs an unknown command and the box quietly stops syncing
 * that connector until someone reads `bbx health`.
 *
 * Only the `runs:` field changes, and only where it names a verb that actually
 * moved. A card whose `runs:` is already prefixed, or names an agent verb like
 * `bbx procedure run`, is left exactly as it was.
 *
 * Usage (invoked by `bbx migrate`):
 *   pnpm exec tsx scripts/migrate/schedule-engine-verbs.ts <boxRoot> --apply
 */
import * as path from "node:path";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { errorMessage } from "../../src/lib/error-guards.js";
import { SURFACE } from "../../src/cli/surface-data.js";

/**
 * The verbs that moved, derived from the surface table rather than listed
 * here — a second hand-written list would be a second thing to forget when a
 * verb is reclassified. Split families are excluded: their `name` still
 * resolves at the top level, so only the whole-verb evictions rename.
 */
const MOVED_VERBS: readonly string[] = SURFACE.filter(
  (entry) => entry.audience === "engine" && entry.subcommands === undefined,
).map((entry) => entry.name);

/**
 * Rewrite one `runs:` command, or return null when nothing moved.
 *
 * Tokenized rather than pattern-matched. A regex over a verb list built at
 * runtime is both a lint violation (`security/detect-non-literal-regexp`) and
 * harder to read than the thing it encodes, which is simply: at each command
 * position, is the program `bbx` and the next word a verb that moved?
 *
 * A command position is the start of the string or whatever follows a shell
 * separator, so `--message "bbx wakeup ran"` is left alone. The program may be
 * an absolute path (`/usr/local/bin/bbx`), so only the last path segment is
 * compared. Leading environment assignments (`BBX_LOG_PROMPTS=1 bbx wakeup`)
 * keep the position open: a hand-edited card that sets a variable inline would
 * otherwise be skipped and left running a command that no longer resolves,
 * which is the silent failure this migration exists to prevent.
 */
export function repointRunsCommand(runs: string): string | null {
  const tokens = runs.split(/(\s+)/);
  let atCommandPosition = true;
  let changed = false;
  const out: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const piece = tokens[i];
    if (piece === undefined) continue;
    out.push(piece);
    if (piece.trim() === "") continue;

    if (atCommandPosition && isBbx(piece)) {
      const next = nextWord(tokens, i);
      if (next !== null && MOVED_VERBS.includes(next.word)) {
        out.push(...tokens.slice(i + 1, next.index), "engine", " ");
        i = next.index - 1;
        changed = true;
      }
    }
    // A separator opens a new command position; an environment assignment keeps
    // one open; anything else closes it.
    atCommandPosition = SEPARATORS.has(piece) || (atCommandPosition && isAssignment(piece));
  }

  return changed ? out.join("") : null;
}

/** Shell words after which a new command begins. */
const SEPARATORS = new Set(["&&", "||", ";", "|", "&"]);

/**
 * A leading `NAME=value` environment assignment. Matched conservatively — a
 * shell variable name, then `=` — and only consulted while already at a command
 * position, so a `--flag=value` argument can never be mistaken for one.
 */
function isAssignment(piece: string): boolean {
  return /^[A-Z_a-z]\w*=/.test(piece);
}

/** Whether a word names the bbx binary, path-qualified or not. */
function isBbx(piece: string): boolean {
  return piece.split("/").at(-1) === "bbx";
}

/** The next non-whitespace word after `from`, with its index. */
function nextWord(tokens: readonly string[], from: number): { word: string; index: number } | null {
  for (let i = from + 1; i < tokens.length; i += 1) {
    const piece = tokens[i];
    if (piece === undefined || piece.trim() === "") continue;
    return { word: piece, index: i };
  }
  return null;
}

/** Every `*.scheduled-script.card` in the box, or [] when there are none. */
async function scheduleCards(boxRoot: string): Promise<string[]> {
  const dir = path.join(boxRoot, "_config", "schedules");
  try {
    const names = await readdir(dir);
    return names.filter((name) => name.endsWith(".scheduled-script.card")).map((name) => path.join(dir, name));
  } catch (error) {
    // A box with no schedules directory has nothing to migrate. Any other
    // failure is real and should surface.
    if (isMissingDirectory(error)) return [];
    throw error;
  }
}

function isMissingDirectory(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * The `runs:` line is edited as TEXT rather than parsed and reserialized.
 * Reserialization would reorder frontmatter and rewrite quoting across every
 * scheduled card in the box, turning a one-piece change into a diff nobody can
 * review — and these cards are ones boxholders hand-edit.
 */
const RUNS_LINE = /^(runs:[\t ]*)(.*)$/m;

/** What one card needs, or null when it is already correct. */
function planCard(text: string): { next: string; from: string; to: string } | null {
  const match = RUNS_LINE.exec(text);
  if (match === null) return null;
  const [, prefix, command] = match;
  if (prefix === undefined || command === undefined) return null;

  const repointed = repointRunsCommand(command.trim());
  if (repointed === null) return null;

  return {
    next: text.replace(RUNS_LINE, `${prefix}${repointed}`),
    from: command.trim(),
    to: repointed,
  };
}

async function main(): Promise<number> {
  const target = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (target === undefined || target === "") {
    process.stderr.write("usage: schedule-engine-verbs <boxRoot> [--apply]\n");
    return 1;
  }

  const boxRoot = path.resolve(target);
  const cards = await scheduleCards(boxRoot);
  let changed = 0;

  for (const card of cards) {
    const text = await readFile(card, "utf8");
    const plan = planCard(text);
    if (plan === null) continue;

    changed += 1;
    const name = path.basename(card);
    if (!apply) {
      process.stdout.write(`[schedule-engine-verbs] would re-point ${name}: ${plan.from} -> ${plan.to}\n`);
      continue;
    }
    await writeFile(card, plan.next, "utf8");
    process.stdout.write(`[schedule-engine-verbs] ${name}: ${plan.from} -> ${plan.to}\n`);
  }

  if (changed === 0) process.stdout.write("[schedule-engine-verbs] no scheduled script names a moved verb.\n");
  return 0;
}

// Guarded so `repointRunsCommand` can be imported by a test without the script
// running and exiting the test process (the convention in
// scripts/migrate/record-measurements.ts and its siblings).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(await main());
  } catch (error) {
    process.stderr.write(`[schedule-engine-verbs] failed: ${errorMessage(error)}\n`);
    process.exit(1);
  }
}
