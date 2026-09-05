/**
 * Job card discovery — scans _bookkeeping/jobs/ for pending job cards.
 *
 * Job cards have the suffix `.job.card` (optionally `.TYPE.job.card`
 * for typed jobs like chat). Priority and source are read from the card's
 * YAML frontmatter (`priority:`, `source:`). When a sourceFilter is
 * provided, jobs whose source does not match are dropped — used by
 * `bbx wakeup --connector X` to scope the reactor to just the jobs that the
 * same partial run produced.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { readCardFrontmatter } from "../card-io.js";
import type { JobCardInfo } from "./types.js";
import { errnoCode } from "../../lib/error-guards.js";

/**
 * Recover when a job card was queued, from its filename's timestamp prefix.
 *
 * Every writer stamps one: `timestampedJobFilename` (intake, chat) emits
 * `YYYY-MM-DDTHH-MM-SS-<stem>.…`, while the contains-backfill and todo-review
 * sweeps emit a minute-resolution `YYYY-MM-DDTHH-MM.…`. Both are UTC, so the
 * parse rebuilds the instant in UTC. A hand-written or legacy filename with no
 * stamp returns `null` and falls back to the mtime.
 */
const FILENAME_STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})(?:-(\d{2}))?(?=[.-])/;

function createdAtFromFilename(file: string): Date | null {
  const m = FILENAME_STAMP.exec(path.basename(file));
  if (!m) return null;
  const [, y, mo, d, h, min, sec] = m;
  const parts = [Number(y), Number(mo), Number(d), Number(h), Number(min), Number(sec ?? "0")] as const;
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
  // `Date.UTC` normalizes rather than rejects — month 99 rolls into a later
  // year, giving a mangled filename a real (and wrong) age. Since this age is
  // now control flow, a stamp that doesn't survive the round trip is treated
  // as no stamp at all.
  const roundTrip = [
    date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(),
  ];
  return roundTrip.every((v, i) => v === parts[i]) ? date : null;
}

async function readCreatedAt(jobPath: string, file: string): Promise<Date | null> {
  const stamped = createdAtFromFilename(file);
  if (stamped !== null) return stamped;
  try {
    return (await fs.stat(jobPath)).mtime;
  } catch (e) {
    // Unreadable stat: age is unknown, which the deadline treats as "young".
    console.debug(`findJobCards: cannot stat ${file}:`, e);
    return null;
  }
}

export async function findJobCards(
  jobsDir: string,
  options?: { typeFilter?: string | undefined; sourceFilter?: string | undefined }
): Promise<JobCardInfo[]> {
  options = options ?? {};
  const { typeFilter, sourceFilter } = options;
  let entries: string[];
  try {
    entries = await fs.readdir(jobsDir, { recursive: true });
  } catch (e) {
    // jobs/ may not exist yet (fresh box, or no jobs produced) — treat as
    // no pending jobs rather than an error. Any other failure is different in
    // kind: the queue may be full of work nobody can see, and every caller
    // (the reactor, the stalled-jobs health check, field-test quiescence)
    // reads the empty result as "nothing pending". Say so.
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`findJobCards: cannot read ${jobsDir}, treating as empty:`, e);
    }
    return [];
  }

  const suffix = typeFilter ? `.${typeFilter}.job.card` : ".job.card";
  const jobFiles = entries.filter((e) => e.endsWith(suffix));
  const results: JobCardInfo[] = [];

  for (const file of jobFiles) {
    const jobPath = path.join(jobsDir, file);
    let priority: "normal" | "low" = "normal";
    let source: string | undefined;
    try {
      const content = await fs.readFile(jobPath, "utf-8");
      const fm = readCardFrontmatter(content);
      if (fm) {
        if (fm["priority"] === "low") priority = "low";
        if (typeof fm["source"] === "string") source = fm["source"];
      }
    } catch (e) {
      // Can't read this card — default to normal priority, no source. The job
      // is still surfaced; whatever processes it will hit the same read error.
      console.debug(`findJobCards: cannot read ${file}, using defaults:`, e);
    }
    if (sourceFilter !== undefined && source !== sourceFilter) continue;
    results.push({ file, priority, createdAt: await readCreatedAt(jobPath, file) });
  }

  // Sort: normal-priority first, low-priority last; within a priority,
  // oldest first, so any cap on how many jobs a cycle admits is FIFO and
  // the tail of a backlog can't be starved by newer arrivals.
  results.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === "normal" ? -1 : 1;
    return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
  });

  return results;
}
