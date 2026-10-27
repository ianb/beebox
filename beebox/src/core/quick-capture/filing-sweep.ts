/** Apply one filing sweep: read records, docs and pending jobs; act on `filingPlan`. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxTime } from "../../lib/time.js";
import { getBoxDir } from "../../lib/paths/core.js";
import { stageAndCommitPaths } from "../../lib/git/core/operations.js";
import { errnoCode } from "../../shared/error-guards.js";
import { readCardFrontmatter, collectRefs } from "../card-io.js";
import { createOrAppendIntakeJob, removeItemsFromIntakeJob } from "../../job-cards/intake-utils.js";
import { reconcileCaptureSource } from "./source.js";
import { listCaptures, readCapture, withCaptureLock, writeCapture, type CaptureRecord } from "./store.js";
import { filingPlan, nextKickAt, FILING_WAITING_ERROR, type FilingDoc } from "./filing.js";

/** Every intake job's refs, with the jobs holding each (box-relative). Only intake jobs hold capture docs. */
async function pendingJobRefs(boxRoot: string): Promise<Map<string, string[]>> {
  const jobsDir = getBoxDir(boxRoot, "jobs");
  const holders = new Map<string, string[]>();
  let files: string[];
  try { files = await fs.readdir(jobsDir); }
  catch (error) { if (errnoCode(error) === "ENOENT") return holders; throw error; }
  for (const file of files) {
    if (!file.endsWith("intake.job.card") && !file.endsWith("intake-job.card")) continue;
    const fields = readCardFrontmatter(await fs.readFile(path.join(jobsDir, file), "utf8"));
    if (fields === null) continue;
    const job = path.relative(boxRoot, path.join(jobsDir, file)).split(path.sep).join("/");
    for (const ref of collectRefs(fields)) holders.set(ref, [...(holders.get(ref) ?? []), job]);
  }
  return holders;
}

async function readDoc(boxRoot: string, record: CaptureRecord | null): Promise<FilingDoc> {
  if (record === null || record.state === "gone" || record.sourceRef === undefined) return null;
  let content: string;
  try { content = await fs.readFile(path.join(boxRoot, record.sourceRef), "utf8"); }
  catch (error) { if (errnoCode(error) === "ENOENT") return null; throw error; }
  const title = readCardFrontmatter(content)?.["title"];
  return { ref: record.sourceRef, title: typeof title === "string" ? title : undefined };
}

async function updateRecord(args: { boxRoot: string; id: string; change: (record: CaptureRecord) => void }): Promise<void> {
  const { boxRoot, id, change } = args;
  await withCaptureLock({ boxRoot, id }, async () => {
    const record = await readCapture(boxRoot, id);
    // A record that left "saved" since the sweep read it (a Retry in progress) keeps its fields for the next sweep.
    if (record === null || record.filingRequested !== true || (record.state !== "saved" && record.state !== "gone")) return;
    change(record);
    await writeCapture(boxRoot, record);
  });
}

function clearFiling(record: CaptureRecord): void {
  delete record.filingRequested; delete record.filingKicks; delete record.filingKickAt;
  if (record.error === FILING_WAITING_ERROR) delete record.error;
}

/**
 * One sweep. Returns true when a box cycle should start now; the caller runs it
 * apart from the sweep, so sweeps keep reconciling (and dequeuing captures that
 * words took over) while a cycle is in its connector phase. With
 * `wakeupRunning`, no new cycle is planned or counted.
 */
export async function runFilingSweep(args: { boxRoot: string; wakeupRunning: boolean; records?: CaptureRecord[] }): Promise<boolean> {
  const { boxRoot } = args;
  const records: CaptureRecord[] = [];
  const docs = new Map<string, FilingDoc>();
  for (const listed of args.records ?? await listCaptures(boxRoot)) {
    if (listed.filingRequested !== true) { records.push(listed); continue; }
    const record = await reconcileCaptureSource(boxRoot, listed.id) ?? listed;
    records.push(record);
    docs.set(record.id, await readDoc(boxRoot, record));
  }
  const holders = await pendingJobRefs(boxRoot);
  const now = getBoxTime(boxRoot).getTime();
  const plan = filingPlan({ records, docs, queued: new Set(holders.keys()), now });

  const changedJobs: string[] = [];
  for (const ref of plan.dequeue) {
    for (const job of holders.get(ref) ?? []) {
      if (await removeItemsFromIntakeJob({ boxRoot, jobRelPath: job, refs: [ref] })) changedJobs.push(job);
    }
  }
  // Dequeued and committed before the request is cleared, so a crash cannot leave a queued capture nothing tracks.
  if (changedJobs.length > 0) await stageAndCommitPaths(boxRoot, { paths: changedJobs, message: "Take captures with words out of filing", trailers: { "Triggered-By": "quick-capture filing" } });
  for (const id of plan.clear) await updateRecord({ boxRoot, id, change: clearFiling });
  if (plan.queue.length > 0) {
    const jobs = await createOrAppendIntakeJob({ boxRoot, items: plan.queue, priority: "normal",
      description: `Triage new items, including ${plan.queue.length} saved capture${plan.queue.length === 1 ? "" : "s"}` });
    await stageAndCommitPaths(boxRoot, { paths: jobs, message: "Queue saved captures for filing", trailers: { "Triggered-By": "quick-capture filing" } });
  }
  for (const id of plan.exhausted) await updateRecord({ boxRoot, id, change: record => { record.error = FILING_WAITING_ERROR; } });
  if (plan.kick.length === 0 || args.wakeupRunning) return false;
  // Recorded before the run, so a crash mid-wakeup cannot start wakeups back to back.
  for (const id of plan.kick) {
    await updateRecord({ boxRoot, id, change: record => {
      const kicks = (record.filingKicks ?? 0) + 1;
      record.filingKicks = kicks; record.filingKickAt = nextKickAt(now, kicks);
    } });
  }
  return true;
}
