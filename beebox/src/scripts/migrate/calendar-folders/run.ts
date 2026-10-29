#!/usr/bin/env tsx
/**
 * `calendar-folders-2026-10` runner: move a box's flat calendar into one card
 * per calendar with its events in the card's attach folder, renamed to
 * `{date}_{title}_{shortId}.ics` (`plan.ts` decides every path).
 *
 * 1. A journal left by an interrupted run is finished first.
 * 2. Plan the box. A plan that cannot place a file exits 1 having written
 *    nothing. Without `--apply` the runner stops after printing the plan.
 * 3. Write the whole plan to the journal (atomically), then the cards, then
 *    the moves (never over an existing file), then the index, then delete the
 *    journal. While the journal exists the calendar connector refuses to sync,
 *    so a half-moved box is never read as new local events to insert.
 * 4. Verify: a fresh plan must find nothing left to move.
 *
 * File contents are not changed, so every recorded content hash still matches
 * its file and a pending local edit stays pending.
 *
 * Usage:
 *   pnpm exec tsx src/scripts/migrate/calendar-folders/run.ts <boxRoot>           # plan only
 *   pnpm exec tsx src/scripts/migrate/calendar-folders/run.ts <boxRoot> --apply
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { writeFileAtomic } from "../../../lib/atomic-write.js";
import { pathExistsStrict } from "../../../lib/file-exists.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { createCalendarTemplate } from "../../../schemas/calendar.js";
import { loadCalendarConfig } from "../../../connectors/google-calendar/config.js";
import { calendarDir, loadCalendarState, saveCalendarState } from "../../../connectors/google-calendar/state.js";
import { calendarMigrationJournalPath, listIcsFiles, loadCalendarFolders } from "../../../connectors/google-calendar/calendar-folders.js";
import { planCalendarFolders, type CalendarFoldersInput } from "./plan.js";

export type RunMode = "plan" | "apply";

const EntrySchema = z.union([z.string(), z.object({
  filename: z.string(),
  calendarId: z.string(),
  contentHash: z.string().optional(),
  remoteUpdated: z.string().optional(),
  pendingSince: z.string().optional(),
})]);

const JournalSchema = z.object({
  cards: z.array(z.object({ path: z.string(), content: z.string() })),
  moves: z.array(z.object({ from: z.string(), to: z.string() })),
  eventFiles: z.record(z.string(), EntrySchema),
});
type Journal = z.infer<typeof JournalSchema>;

async function readFiles(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const name of (await listIcsFiles(dir)).toSorted()) files.set(name, await fs.readFile(path.join(dir, name), "utf-8"));
  return files;
}

/** Names directly in `calRoot`, plus one level into each attach folder. */
async function existingNames(calRoot: string): Promise<Set<string>> {
  const names = new Set<string>();
  let top: string[];
  try {
    top = await fs.readdir(calRoot);
  } catch (err: unknown) {
    if (errnoCode(err) !== "ENOENT") throw err;
    return names;
  }
  for (const name of top) {
    names.add(name);
    if (!name.endsWith(".attach")) continue;
    for (const inner of await fs.readdir(path.join(calRoot, name))) names.add(`${name}/${inner}`);
  }
  return names;
}

async function readInput(boxRoot: string): Promise<CalendarFoldersInput> {
  const calRoot = calendarDir(boxRoot);
  const config = await loadCalendarConfig(boxRoot);
  const state = await loadCalendarState(boxRoot);
  const found = await loadCalendarFolders({ boxRoot, calRoot });
  return {
    index: state.eventFiles,
    topFiles: await readFiles(calRoot),
    strandedFiles: await readFiles(path.join(calRoot, "stranded")),
    cards: new Map([...found.byId].map(([id, ref]) => [id, path.basename(ref.cardPath, ".calendar.card")])),
    existing: await existingNames(calRoot),
    calendars: config.calendars ?? ["primary"],
    names: config.calendarNames ?? {},
    roles: config.calendarRoles ?? {},
  };
}

/**
 * Carry out a journal. Safe to repeat: a move already made is skipped. Returns
 * the problem that stopped it, with the journal left in place, or undefined.
 */
async function applyJournal(boxRoot: string, journal: Journal): Promise<string | undefined> {
  const calRoot = calendarDir(boxRoot);
  for (const card of journal.cards) {
    const cardPath = path.join(calRoot, card.path);
    await fs.mkdir(path.join(calRoot, card.path.replace(/\.calendar\.card$/, ".attach")), { recursive: true });
    if (!await pathExistsStrict(cardPath, { followLinks: false })) await fs.writeFile(cardPath, card.content);
  }
  for (const { from, to } of journal.moves) {
    const source = path.join(calRoot, from);
    const target = path.join(calRoot, to);
    const hasSource = await pathExistsStrict(source, { followLinks: false });
    const hasTarget = await pathExistsStrict(target, { followLinks: false });
    if (!hasSource && hasTarget) continue; // done by an earlier attempt
    if (!hasSource) return `${from} is gone and ${to} does not exist`;
    if (hasTarget) return `will not move ${from} over existing ${to}`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(source, target);
  }
  const state = await loadCalendarState(boxRoot);
  state.eventFiles = journal.eventFiles;
  await saveCalendarState(boxRoot, { state, snapshot: { tokens: { ...state.syncTokens } } });
  await fs.rm(calendarMigrationJournalPath(boxRoot));
  return undefined;
}

/** Finish an interrupted run's journal: none there, finished, or the problem that stopped it. */
async function resumeJournal(boxRoot: string): Promise<{ kind: "none" | "finished" } | { kind: "stuck"; problem: string }> {
  let text: string;
  try {
    text = await fs.readFile(calendarMigrationJournalPath(boxRoot), "utf-8");
  } catch (err: unknown) {
    if (errnoCode(err) === "ENOENT") return { kind: "none" };
    throw err;
  }
  const parsed = JournalSchema.safeParse(JSON.parse(text));
  if (!parsed.success) return { kind: "stuck", problem: "the journal does not parse" };
  const problem = await applyJournal(boxRoot, parsed.data);
  return problem === undefined ? { kind: "finished" } : { kind: "stuck", problem };
}

const stuck = (problem: string): { code: number; lines: string[] } => ({
  code: 1,
  lines: [`calendar-folders: stopped: ${problem}. The journal stays at _bookkeeping/connectors/google-calendar-migration.json and calendar sync is refused until it is resolved.`],
});

/** One run over one box. Returns the exit code and the lines it printed. */
export async function runCalendarFolders({ boxRoot, mode }: { boxRoot: string; mode: RunMode }): Promise<{ code: number; lines: string[] }> {
  const resume = mode === "apply" ? await resumeJournal(boxRoot) : { kind: "none" as const };
  if (resume.kind === "stuck") return stuck(resume.problem);
  const resumed = resume.kind === "finished";
  const plan = planCalendarFolders(await readInput(boxRoot));
  if (plan.kind === "error") return { code: 1, lines: ["calendar-folders: cannot plan; nothing written.", ...plan.reasons] };
  if (plan.kind === "current") {
    return { code: 0, lines: [resumed ? "calendar-folders: finished an interrupted run." : "calendar-folders: already current."] };
  }
  const summary = [
    ...plan.cards.map((card) => `card ${card.stem}.calendar.card for ${card.id}`),
    ...plan.moves.map((m) => `move ${m.from} -> ${m.to}`),
    ...plan.leftAlone.map((f) => `left alone (no calendar named in the file): ${f}`),
  ];
  if (mode === "plan") return { code: 0, lines: [...summary, "(dry run; pass --apply)"] };

  const journal: Journal = {
    cards: plan.cards.map((card) => ({
      path: `${card.stem}.calendar.card`,
      content: createCalendarTemplate({ name: card.name, id: card.id, access: card.access, syncing: card.syncing }),
    })),
    moves: plan.moves,
    eventFiles: plan.index,
  };
  await writeFileAtomic(calendarMigrationJournalPath(boxRoot), { content: JSON.stringify(journal, null, 2) });
  const problem = await applyJournal(boxRoot, journal);
  if (problem !== undefined) return stuck(problem);
  const after = planCalendarFolders(await readInput(boxRoot));
  if (after.kind !== "current") return { code: 1, lines: ["calendar-folders: verify failed: files are still outside calendar folders."] };
  return { code: 0, lines: summary.map((line) => `calendar-folders: ${line}`) };
}

// CLI entry — only when run directly, not when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const boxRoot = args.find((a) => !a.startsWith("--"));
  if (boxRoot === undefined) {
    console.error("Usage: calendar-folders/run.ts <boxRoot> [--apply]\n\nMove calendar events into one attach folder per calendar card.");
    process.exit(1);
  }
  const mode: RunMode = args.includes("--apply") ? "apply" : "plan";
  const { code, lines } = await runCalendarFolders({ boxRoot: path.resolve(boxRoot), mode });
  for (const line of lines) (code === 0 ? console.log : console.error)(line);
  process.exit(code);
}
