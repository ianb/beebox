/** Filesystem-only boundaries for preparing disposable journey boxes. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { readJson } from "../../../src/scripts/user-stories/json-io.ts";
import { claudeProjectsRoot, encodeProjectDir } from "../../../src/core/chat/session/transcript-paths.ts";

/**
 * Run directories (walker notes, shots, before/after JSON) live at the monorepo root, outside
 * `beebox/`. A box's `node_modules/beebox` links to the dev checkout's `beebox/`, so anything
 * under it is one `grep` away from the box agent the walk is measuring.
 */
export const JOURNEY_WORK = resolve(import.meta.dirname, "../../../..", "user-stories-work", "journeys");

class UnreportedJourneyError extends Error {
  constructor({ name, notes, report }: { name: string; notes: string; report: string }) {
    super(`${name} has notes but no after-action report. Read ${notes} and write ${report} before another run. Evidence has been preserved.`);
    this.name = "UnreportedJourneyError";
  }
}

class InvalidJourneyIdError extends Error {
  constructor(id: string) {
    super(`Invalid journey id: ${id}`);
    this.name = "InvalidJourneyIdError";
  }
}

export function assertPreviousRunsReported({ work, journeyDir, id }: { work: string; journeyDir: string; id: string }): void {
  if (!existsSync(work)) return;
  for (const name of readdirSync(work).filter((entry) => entry.startsWith(`${id}-`))) {
    const notes = join(work, name, "notes.md");
    if (!existsSync(notes) || readFileSync(notes, "utf8").trim() === "") continue;
    const report = join(journeyDir, "reports", `${name.slice(id.length + 1)}.md`);
    if (!existsSync(report) || readFileSync(report, "utf8").trim() === "") {
      throw new UnreportedJourneyError({ name, notes, report });
    }
  }
}

/** Avoid both run and box collisions, including transcripts left outside a box. */
export function allocateRun({ work, boxes, id, date }: { work: string; boxes: string; id: string; date?: string }): {
  runDir: string; boxDir: string; boxSlug: string;
} {
  if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u.test(id)) throw new InvalidJourneyIdError(id);
  const projects = claudeProjectsRoot();
  for (let n = 1; ; n++) {
    const name = `${id}-${date ?? new Date().toISOString().slice(0, 10)}${n === 1 ? "" : `-${n}`}`;
    const runDir = join(work, name);
    const boxSlug = name.toLowerCase();
    const boxDir = join(boxes, boxSlug);
    const transcripts = join(projects, encodeProjectDir(boxDir));
    if (!existsSync(runDir) && !existsSync(boxDir) && !existsSync(transcripts)) return { runDir, boxDir, boxSlug };
  }
}

/** A run started this recently with no after.json is taken to be live (a walk is hours at most). */
const LIVE_RUN_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * Journey runs prepared and not yet collected, started within the last 12 hours.
 * Walks sharing one server slow each other down, so a run records how many ran
 * beside it; timings from rounds with different counts are not comparable.
 */
export function liveRuns({ work, now }: { work: string; now: number }): string[] {
  if (!existsSync(work)) return [];
  return readdirSync(work).filter((name) => {
    const before = join(work, name, "before.json");
    if (!existsSync(before) || existsSync(join(work, name, "after.json"))) return false;
    const started = Date.parse(readJson<{ startedIso: string }>(before).startedIso);
    return now - started <= LIVE_RUN_WINDOW_MS;
  });
}
