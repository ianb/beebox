/**
 * Utilities for creating and appending to intake job cards.
 *
 * `bbx wakeup`, scan import, and wordless capture filing call
 * createOrAppendIntakeJob() for new inbox items. Items join the newest pending
 * intake job with the same batching key, `(connector, priority)`, that has
 * room; one job holds at most `INTAKE_JOB_MAX_ITEMS`, and the rest start new
 * jobs of the same key. A job that grew without limit once held 300 items, and
 * its batch prompt passed the model's limit
 * (docs/plans/bounded-reactor-batches.md).
 *
 * `connector` is set only by a connector-scoped wakeup, and is the reactor's
 * connector filter key: use the connector's canonical name (e.g. "gmail"), or
 * `bbx wakeup --connector X` won't pick up the job it just created. Scan
 * import has no connector; its items join the unscoped normal-priority job.
 *
 * The whole find/read/append/write span is serialized per batching key,
 * because it is a read-modify-write of one job card that two *processes*
 * genuinely race: the scan promote worker inside `bbx serve` appends to the
 * unscoped job while a full wakeup appends its own inbox items — and an
 * unlocked append re-reads, re-renders and rewrites the card wholesale, so the
 * loser's items vanish. Cross-process
 * → `file-lock.ts`; `withCardLock` on top for the in-process racers a PID-blind
 * file lock cannot see (both layers, same reasoning as question-transition.ts).
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../shared/error-guards.js";
import { withFileLock } from "../lib/file-lock.js";
import { withCardLock } from "../lib/card-lock.js";
import { getBoxDir } from "../lib/paths/core.js";
import { parseFrontmatterObject, renderFrontmatterBlock } from "../exports/cards.js";
import { createIntakeJobTemplate, type IntakeJobFields } from "../schemas/intake-job.js";
import { timestampedJobFilename } from "./core.js";

/** The most items one intake job holds: what one agent session can triage. */
export const INTAKE_JOB_MAX_ITEMS = 25;

export interface IntakeJobOptions {
  boxRoot: string;
  /** The connector whose scoped wakeup found these items; unset otherwise. */
  connector?: string | undefined;
  items: string[];
  priority?: "normal" | "low";
  description: string;
}

/**
 * The filename stem for a new intake job: the connector's name, or `inbox`
 * for an unscoped job, with `-low` for a low-priority one. A new job's name
 * adds a random suffix, since one call can create several jobs of a key in
 * the same second.
 */
function intakeJobStem(connector: string | undefined, priority: "normal" | "low"): string {
  const base = connector === undefined ? "inbox" : safeStem(connector);
  return priority === "low" ? `${base}-low` : base;
}

function safeStem(name: string): string {
  return name.replace(/[^\dA-Za-z-]/g, "-");
}

/** The description a job's item count implies. */
function countDescription(count: number, priority: "normal" | "low"): string {
  const label = priority === "low" ? "capture item" : "inbox item";
  return `Triage ${count} ${label}${count === 1 ? "" : "s"}`;
}

/**
 * Add `items` to intake jobs of the `(connector, priority)` key: first to the
 * newest pending one with room, up to `INTAKE_JOB_MAX_ITEMS`, then to new jobs
 * of at most that many. Returns the relative path of every job written, for
 * the caller to commit.
 */
export async function createOrAppendIntakeJob(
  opts: IntakeJobOptions
): Promise<string[]> {
  const priority = opts.priority ?? "normal";
  return withIntakeKeyLock(opts.boxRoot, {
    connector: opts.connector, priority, run: () => createOrAppendIntakeJobLocked(opts, priority),
  });
}

/**
 * Run `fn` holding the batching key's locks. Per key: two keys never contend
 * (each finds its own pending job), and narrowing the lock keeps a slow
 * connector from blocking an unrelated one. The `connector-` prefix keeps a
 * connector named like the unscoped lock from sharing it.
 */
async function withIntakeKeyLock<T>(
  boxRoot: string,
  { connector, priority, run }: { connector: string | undefined; priority: "normal" | "low"; run: () => Promise<T> },
): Promise<T> {
  const lockName = connector === undefined
    ? `unscoped-${priority}`
    : `connector-${safeStem(connector)}-${priority}`;
  const lockPath = path.join(boxRoot, ".beebox", "intake-job-locks", `${lockName}.lock`);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  // The file lock is keyed on a path, not a card, so it doubles as the
  // in-process key: `withCardLock(lockPath, …)` serializes same-process racers
  // (which the PID-blind file lock cannot see) on exactly the same granularity.
  return withCardLock(lockPath, () =>
    withFileLock(
      { lockPath, metadata: { purpose: "intake-job", key: lockName }, waitMs: INTAKE_LOCK_WAIT_MS },
      run,
    ),
  );
}

/**
 * Remove `refs` from an intake job's `items`, under the job's batching-key
 * lock, rewriting its description to the remaining count. Deletes the card
 * when no items remain — the same unlink `finishJob` does, left for the
 * caller to commit with its own change. A connector-scoped wakeup uses this
 * to take items from a job its reactor will not process. Returns false when
 * the card is gone or held none of the refs.
 */
export async function removeItemsFromIntakeJob(opts: {
  boxRoot: string;
  jobRelPath: string;
  refs: string[];
}): Promise<boolean> {
  const jobPath = path.join(opts.boxRoot, opts.jobRelPath);
  const key = await readIntakeJobFields(jobPath);
  if (key === null) return false;
  // The loose read skips schema defaults, so an omitted priority is "normal".
  const priority = key.priority === "low" ? "low" : "normal";
  return withIntakeKeyLock(opts.boxRoot, { connector: key.connector, priority, run: async () => {
    // Re-read under the lock: an append may have landed since the key read.
    const fields = await readIntakeJobFields(jobPath);
    if (fields === null) return false;
    const drop = new Set(opts.refs);
    const kept = fields.items.filter((item) => !drop.has(item.ref));
    if (kept.length === fields.items.length) return false;
    if (kept.length === 0) {
      await fs.unlink(jobPath);
      return true;
    }
    fields.description = countDescription(kept.length, priority);
    fields.items = kept;
    await fs.writeFile(jobPath, renderFrontmatterBlock(fields));
    return true;
  } });
}

/** How long an intake-job writer waits for a contending one before failing. */
const INTAKE_LOCK_WAIT_MS = 10_000;

/** The find/read/append/write span itself; runs with both locks held. */
async function createOrAppendIntakeJobLocked(
  opts: IntakeJobOptions,
  priority: "normal" | "low",
): Promise<string[]> {
  const jobsDir = getBoxDir(opts.boxRoot, "jobs");
  await fs.mkdir(jobsDir, { recursive: true });
  const written: string[] = [];
  let rest = opts.items;

  const existing = rest.length === 0 ? null : await newestIntakeJobWithRoom(jobsDir, { connector: opts.connector, priority });
  if (existing !== null) {
    const taken = rest.slice(0, INTAKE_JOB_MAX_ITEMS - existing.fields.items.length);
    rest = rest.slice(taken.length);
    const items = [...existing.fields.items, ...taken.map((ref) => ({ ref }))];
    // The caller's description names only its own items; the count is true of the job.
    await fs.writeFile(existing.path, renderFrontmatterBlock({ ...existing.fields, items, description: countDescription(items.length, priority) }));
    written.push(path.relative(opts.boxRoot, existing.path));
  }

  for (let i = 0; i < rest.length; i += INTAKE_JOB_MAX_ITEMS) {
    const items = rest.slice(i, i + INTAKE_JOB_MAX_ITEMS);
    const jobFilename = timestampedJobFilename(opts.boxRoot, {
      stem: intakeJobStem(opts.connector, priority),
      extension: "intake.job.card",
      suffix: randomBytes(4).toString("hex"),
    });
    const jobPath = path.join(jobsDir, jobFilename);
    const description = items.length === opts.items.length ? opts.description : countDescription(items.length, priority);
    await fs.writeFile(jobPath, createIntakeJobTemplate({ connector: opts.connector, priority, description, items }));
    written.push(path.relative(opts.boxRoot, jobPath));
  }
  return written;
}

/**
 * The newest pending intake job (latest filename stamp) of the key with fewer
 * than `INTAKE_JOB_MAX_ITEMS` items, or null. The newest, so an older job's
 * content, and with it the job check's backoff for it, stays still.
 */
async function newestIntakeJobWithRoom(
  jobsDir: string,
  key: { connector: string | undefined; priority: "normal" | "low" }
): Promise<{ path: string; fields: IntakeJobFields } | null> {
  const names = (await fs.readdir(jobsDir)).filter((name) => name.endsWith(".intake.job.card")).toSorted().toReversed();
  for (const name of names) {
    const jobPath = path.join(jobsDir, name);
    const fields = await readIntakeJobFields(jobPath);
    if (fields === null || fields.connector !== key.connector) continue;
    if ((fields.priority === "low" ? "low" : "normal") !== key.priority) continue;
    if (!Array.isArray(fields.items)) continue;
    if (fields.items.length < INTAKE_JOB_MAX_ITEMS) return { path: jobPath, fields };
  }
  return null;
}

async function readIntakeJobFields(filePath: string): Promise<IntakeJobFields | null> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`readIntakeJobFields: could not read ${filePath}, skipping:`, e);
    }
    return null;
  }
  // Parse boundary: the loose frontmatter read yields a plain mapping, which we
  // vouch for as IntakeJobFields (validated on load elsewhere; this is a
  // best-effort append path).
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: best-effort append path; the loose frontmatter mapping is vouched for as IntakeJobFields (validated on load elsewhere)
  return parseFrontmatterObject(content) as IntakeJobFields | null;
}
