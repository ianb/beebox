/**
 * Filing for captures that arrive with no words (docs/implemented-plans/file-wordless-captures.md).
 * The worker requests filing; the sweep waits until the owner's burst settles,
 * queues the docs on the unscoped intake job, and starts a wakeup. Done is read
 * from the doc (retitled or moved), never from the job disappearing: `bbx finish`
 * deletes a whole job card, including items appended after the reactor read it.
 */
import type { CaptureRecord } from "./store.js";

const FILING_SETTLE_MS = 2 * 60 * 1000;
const FILING_MAX_KICKS = 6;
export const PLACEHOLDER_TITLE = "Saved capture";
export const FILING_WAITING_ERROR = "Filing is waiting for the box's next cycle.";
const CAPTURES_PREFIX = "_content/captures/";

/** Material the person saved with no words of their own; a recording keeps its retry path instead. */
export function isWordless(record: CaptureRecord): boolean {
  return record.state === "saved" && hasWordlessDeclaration(record);
}
/** The declaration alone, whatever the state: a capture still being prepared already holds its owner's burst open. */
function hasWordlessDeclaration(record: CaptureRecord): boolean {
  const kind = record.declaration.material?.kind;
  return (record.declaration.input?.trim() ?? "") === "" && record.declaration.parentCaptureId === undefined
    && (kind === "image" || kind === "url" || kind === "clipping");
}

/** The capture's doc as the sweep found it; null when the source is gone. */
export type FilingDoc = { ref: string; title: string | undefined } | null;

export interface FilingPlan {
  /** Done, gone, or taken over by words: drop the filing fields. */
  clear: string[];
  /** Refs to remove from pending jobs because words took the capture over. */
  dequeue: string[];
  /** Refs to append to the intake job. */
  queue: string[];
  /** Records whose next wakeup is now; empty when no wakeup is due. */
  kick: string[];
  /** Records out of wakeup attempts that do not show the waiting error yet. */
  exhausted: string[];
}

function isFiled(doc: FilingDoc): boolean {
  return doc === null || !doc.ref.startsWith(CAPTURES_PREFIX) || doc.title !== PLACEHOLDER_TITLE;
}

/** Every filing decision for one sweep, from records and what the sweep read. Pure. */
export function filingPlan(args: { records: CaptureRecord[]; docs: ReadonlyMap<string, FilingDoc>; queued: ReadonlySet<string>; now: number }): FilingPlan {
  const { records, docs, queued, now } = args;
  const plan: FilingPlan = { clear: [], dequeue: [], queue: [], kick: [], exhausted: [] };
  // Words take a capture over once delivered. Until then it waits; a context event deleted before delivery gives it back.
  const delivered = new Set(records.flatMap(record => record.state === "sent" ? record.declaration.parentCaptureId ?? [] : []));
  const pending = new Set(records.flatMap(record => record.state === "gone" || record.state === "sent" ? [] : record.declaration.parentCaptureId ?? []));
  const waiting: CaptureRecord[] = [];
  for (const record of records) {
    if (record.filingRequested !== true) continue;
    const doc = docs.get(record.id) ?? null;
    if (delivered.has(record.id) || pending.has(record.id)) {
      if (delivered.has(record.id)) plan.clear.push(record.id);
      if (doc !== null && queued.has(doc.ref)) plan.dequeue.push(doc.ref);
    } else if (record.state === "gone" || isFiled(doc)) plan.clear.push(record.id);
    // Retry passes through "preparing" on its way back to "saved"; the request stays.
    else if (record.state === "saved") waiting.push(record);
  }
  const unsettled = new Set(records.filter(record => record.state !== "gone" && hasWordlessDeclaration(record)
    && now - Date.parse(record.acceptedAt) < FILING_SETTLE_MS).map(record => record.owner));
  for (const record of waiting) {
    if (unsettled.has(record.owner)) continue;
    const ref = docs.get(record.id)?.ref;
    if (ref !== undefined && !queued.has(ref)) plan.queue.push(ref);
    const kicks = record.filingKicks ?? 0;
    if (kicks >= FILING_MAX_KICKS) { if (record.error !== FILING_WAITING_ERROR) plan.exhausted.push(record.id); }
    else if (record.filingKickAt === undefined || Date.parse(record.filingKickAt) <= now) plan.kick.push(record.id);
  }
  return plan;
}

/** When the next wakeup for a record may start, after `kicks` attempts: 2, 4, 8, then every 15 minutes. */
export function nextKickAt(now: number, kicks: number): string {
  return new Date(now + Math.min(15, 2 ** kicks) * 60 * 1000).toISOString();
}
