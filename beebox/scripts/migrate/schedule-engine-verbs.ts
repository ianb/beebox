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
 * Matches `bbx <verb>` at a command position — the start of the string, or
 * after a shell separator — so a `--message "bbx wakeup ran"` argument is not
 * rewritten. The binary may be an absolute path (`/usr/local/bin/bbx`), which
 * is why the name is matched with a trailing-segment pattern.
 */
export function repointRunsCommand(runs: string): string | null {
  const verbs = MOVED_VERBS.join("|");
  const pattern = new RegExp(String.raw`(^|[&;|]\s*)(\S*\bbbx)\s+(${verbs})\b`, "g");
  const rewritten = runs.replace(pattern, (_match, lead: string, binary: string, verb: string) =>
    `${lead}${binary} engine ${verb}`,
  );
  return rewritten === runs ? null : rewritten;
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
 * scheduled card in the box, turning a one-token change into a diff nobody can
 * review — and these cards are ones boxholders hand-edit.
 */
const RUNS_LINE = /^(runs:[ \t]*)(.*)$/m;

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

try {
  process.exit(await main());
} catch (error) {
  process.stderr.write(`[schedule-engine-verbs] failed: ${errorMessage(error)}\n`);
  process.exit(1);
}
