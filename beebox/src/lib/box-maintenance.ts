/** Shared admission for box writers and exclusive lifecycle operations. */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { acquireLock, inspectLock, LockHeldError, releaseLock, scanLocks, updateLockMetadata, withFileLock, type LockHolder } from "./file-lock.js";
import { resolveGitDir } from "./git-lock.js";
import { writeFileAtomic } from "./atomic-write.js";
import { errnoCode } from "./error-guards.js";
import { invariant } from "./invariant.js";

const permitSchema = z.object({ directory: z.string(), id: z.string().uuid(), maintenance: z.boolean() });
type Permit = z.infer<typeof permitSchema>;
const phaseSchema = z.object({
  id: z.string().uuid(), reason: z.string(), phase: z.enum(["draining", "exclusive", "ready"]),
  /** When a draining phase gives up waiting; absent once changes begin, when reopening is not predictable. */
  until: z.string().datetime().optional(),
});
type Phase = z.infer<typeof phaseSchema>;
const workHolderSchema = z.object({ reason: z.string(), since: z.string() });
const workLeaseSchema = z.object({ holders: z.array(workHolderSchema).default([]) });
/** One admitted piece of work, as another process sees it. */
export interface WorkHolder { pid: number; reason: string; since: string }
const context = new AsyncLocalStorage<Permit | null>();
const directories = new Map<string, Promise<string>>();
interface ProcessLease {
  count: number; permit: Permit; ready: Promise<unknown>;
  holders: Map<symbol, z.infer<typeof workHolderSchema>>;
  publish: NodeJS.Timeout | null;
}
const processes = new Map<string, ProcessLease>();
const HOLDER_PUBLISH_MS = 250;

type MaintenanceRefusal = "foreign" | "expired" | "closed" | "recovery" | "nested" | "timeout";

/** A refusal that names what holds the box and, when it is known, how long. */
export class BoxMaintenanceError extends Error {
  readonly reason: MaintenanceRefusal;
  /** How long until a closed box is expected to reopen, when its phase records a deadline. */
  readonly retryAfterMs: number | undefined;
  /** The maintenance owner that refused this one, when another owner holds the box. */
  readonly holder: WorkHolder | undefined;
  constructor(opts: { reason: MaintenanceRefusal; detail?: string; retryAfterMs?: number; holder?: WorkHolder }) {
    const messages = {
      foreign: "Work permission belongs to another box", expired: "Work permission has expired",
      closed: "Box admission is closed; retry after maintenance", recovery: "Interrupted maintenance needs recovery",
      nested: "Nested maintenance is not allowed", timeout: "Timed out draining box work",
    };
    super(opts.reason === "closed" && opts.detail ? closedMessage(opts.detail, opts.retryAfterMs) : `${messages[opts.reason]}${opts.detail ? `: ${opts.detail}` : ""}`);
    this.name = "BoxMaintenanceError";
    this.reason = opts.reason;
    this.retryAfterMs = opts.retryAfterMs;
    this.holder = opts.holder;
  }
}

/** Another maintenance owner holds the box: a refusal, not a crash, and its sidecar says who. */
function ownerHeldError(error: LockHeldError): BoxMaintenanceError {
  const reason = typeof error.holder.metadata.reason === "string" ? error.holder.metadata.reason : "maintenance";
  const holder = { pid: error.holder.pid, reason, since: error.holder.acquiredAt };
  return new BoxMaintenanceError({ reason: "closed", detail: `${reason} (pid ${String(holder.pid)}, since ${holder.since})`, holder });
}

function closedMessage(reason: string, retryAfterMs: number | undefined): string {
  const wait = retryAfterMs === undefined ? "" : `; expected to reopen within ${String(Math.max(1, Math.ceil(retryAfterMs / 60_000)))} min`;
  return `Box is closed for ${reason}${wait}`;
}

function closedError(phase: Phase): BoxMaintenanceError {
  const remaining = phase.until === undefined ? undefined : Math.max(0, Date.parse(phase.until) - Date.now());
  return new BoxMaintenanceError({ reason: "closed", detail: phase.reason, ...(remaining === undefined ? {} : { retryAfterMs: remaining }) });
}

function directoryFor(boxRoot: string): Promise<string> {
  let pending = directories.get(boxRoot);
  if (!pending) {
    pending = resolveGitDir(boxRoot).then((gitDir) => {
      invariant(gitDir !== null, `Box maintenance requires a Git repository: ${boxRoot}`);
      return join(gitDir, "bbx-maintenance");
    });
    directories.set(boxRoot, pending);
    void pending.catch(() => directories.delete(boxRoot));
  }
  return pending;
}

export function withoutBoxWork<T>(fn: () => T): T { return context.run(null, fn); }

/** Sidecar diagnostics lag admission by at most one coalescing window. */
function publishHolders(lease: ProcessLease): void {
  if (lease.publish) return;
  lease.publish = setTimeout(() => {
    lease.publish = null;
    void lease.ready
      .then(() => updateLockMetadata(leasePath(lease.permit), { id: lease.permit.id, holders: [...lease.holders.values()] }))
      .catch((error: unknown) => { console.warn("[box-maintenance] work holders were not published:", error); });
  }, HOLDER_PUBLISH_MS);
  lease.publish.unref();
}

function holdersOf(pid: number, holder: LockHolder): WorkHolder[] {
  const parsed = workLeaseSchema.safeParse(holder.metadata);
  const listed = parsed.success ? parsed.data.holders : [];
  return listed.length > 0 ? listed.map((entry) => ({ pid, ...entry })) : [{ pid, reason: "unknown", since: holder.acquiredAt }];
}

export function describeWorkHolders(holders: readonly WorkHolder[]): string {
  return holders.map((holder) => `${holder.reason} since ${holder.since} (pid ${String(holder.pid)})`).join(", ");
}

function leasePath(permit: Permit): string {
  return permit.maintenance ? join(permit.directory, "owner.lock") : join(permit.directory, "work", `${permit.id}.lock`);
}
async function readPhase(directory: string): Promise<Phase | null> {
  try { return phaseSchema.parse(JSON.parse(await readFile(join(directory, "phase.json"), "utf8"))); }
  catch (error) { if (errnoCode(error) === "ENOENT") return null; throw error; }
}
async function validPermit(directory: string, inherited?: string | null): Promise<Permit | undefined> {
  if (inherited === null) return undefined;
  const encoded = inherited ?? (context.getStore() !== undefined ? undefined : process.env.BBX_BOX_WORK);
  const parsed = encoded === undefined ? context.getStore() : permitSchema.parse(JSON.parse(encoded));
  if (!parsed) return undefined;
  if (parsed.directory !== directory) throw new BoxMaintenanceError({ reason: "foreign" });
  const holder = await inspectLock(leasePath(parsed));
  if (holder?.metadata.id !== parsed.id) throw new BoxMaintenanceError({ reason: "expired" });
  return parsed;
}

export interface BoxWork {
  run<T>(fn: () => T): T;
  release(): Promise<void>;
}

/** Serialize lease publication with the drain's zero-reader observation. */
function withAdmission<T>(directory: string, fn: () => Promise<T>): Promise<T> {
  return withFileLock({ lockPath: join(directory, "admission.lock"), metadata: {}, waitMs: 10_000 }, fn);
}

/** Retain before checking phase: closure cannot miss a writer that saw open. */
export interface BoxWorkRequest {
  /** Diagnostic label published in the lease sidecar; a blocked drain reports it. */
  reason: string;
  /** An encoded parent permit, `null` for independent root work, absent to inherit ambient context. */
  inherited?: string | null | undefined;
}

export async function acquireBoxWork(boxRoot: string, { reason, inherited }: BoxWorkRequest): Promise<BoxWork> {
  const directory = await directoryFor(boxRoot);
  if (!inherited && (inherited === null || context.getStore() === null || !context.getStore() && !process.env.BBX_BOX_WORK)) {
    const closed = await readPhase(directory);
    if (closed) throw closedError(closed);
  }
  return withAdmission(directory, async () => {
    const holder = { reason, since: new Date().toISOString() };
    const token = Symbol(reason);
    let held = processes.get(directory);
    if (!held) {
      const permit = { directory, id: randomUUID(), maintenance: false };
      held = { count: 0, permit, ready: acquireLock(leasePath(permit), { id: permit.id, holders: [holder] }), holders: new Map(), publish: null };
      processes.set(directory, held);
    } else {
      publishHolders(held);
    }
    held.count += 1;
    held.holders.set(token, holder);
    let released = false;
    const work = held;
    const release = async (): Promise<void> => {
      if (released) return;
      released = true;
      work.count -= 1;
      work.holders.delete(token);
      if (work.count === 0) {
        if (processes.get(directory) === work) processes.delete(directory);
        if (work.publish) { clearTimeout(work.publish); work.publish = null; }
        await releaseLock(leasePath(work.permit));
      } else {
        publishHolders(work);
      }
    };
    try {
      await work.ready;
      const parent = await validPermit(directory, inherited);
      const phase = await readPhase(directory);
      if (phase && !parent) throw closedError(phase);
      if (phase && phase.phase !== "draining" && !parent?.maintenance) {
        throw new BoxMaintenanceError({ reason: "recovery", detail: phase.reason });
      }
      const permit = parent?.maintenance ? parent : work.permit;
      return { run: (fn) => context.run(permit, fn), release };
    } catch (error) { await release(); throw error; }
  });
}

export async function withBoxWork<T>({ boxRoot, reason }: { boxRoot: string; reason: string }, fn: () => Promise<T>): Promise<T> {
  const work = await acquireBoxWork(boxRoot, { reason });
  try { return await work.run(fn); } finally { await work.release(); }
}

export type BoxPeek<T> = { admitted: true; value: T } | { admitted: false };

/** Read box state under ordinary admission, so a closed box refuses the read instead of waiting. */
export async function peekBoxWork<T>(request: { boxRoot: string; reason: string }, fn: () => Promise<T>): Promise<BoxPeek<T>> {
  try { return { admitted: true, value: await withBoxWork(request, fn) }; }
  catch (error) {
    if (error instanceof BoxMaintenanceError) return { admitted: false };
    throw error;
  }
}

/** Live admitted work in other processes. Diagnostic: exclusion never reads it. */
export async function boxWorkHolders(boxRoot: string): Promise<WorkHolder[]> {
  const directory = await directoryFor(boxRoot);
  const locks = await scanLocks(join(directory, "work"), { suffix: ".lock", profile: "default" });
  return [...locks.values()].filter((holder) => holder.pid !== process.pid).flatMap((holder) => holdersOf(holder.pid, holder));
}

/** Only the current admitted operation can delegate, never ambient server state. */
export function boxWorkEnvironment(): Record<string, string> {
  const permit = context.getStore();
  // CLI actions install their validated admission here; servers do not.
  const inherited = permit === null ? undefined : process.env.BBX_BOX_WORK;
  return permit ? { BBX_BOX_WORK: JSON.stringify(permit) } : inherited ? { BBX_BOX_WORK: inherited } : {};
}

export async function boxMaintenanceStatus(boxRoot: string): Promise<Phase | null> {
  return readPhase(await directoryFor(boxRoot));
}

export interface BoxMaintenance extends BoxWork {
  drain(): Promise<void>;
  prepare(): Promise<void>;
  beginChanges(): Promise<void>;
  complete(): Promise<void>;
}

/** Close first, then drain. Failed changing attempts stay closed for recovery. */
export async function closeBoxMaintenance(
  boxRoot: string,
  opts: { reason: string; drainMs?: number; recover?: boolean; join?: boolean },
): Promise<BoxMaintenance> {
  const directory = await directoryFor(boxRoot);
  if (opts.join) {
    const fleet = process.env.BBX_MAINTENANCE_PERMITS;
    const candidates = fleet ? z.record(z.string(), z.string()).parse(JSON.parse(fleet)) : {};
    const encoded = Object.values(candidates).find((value) => permitSchema.parse(JSON.parse(value)).directory === directory);
    const parent = await validPermit(directory, encoded ?? process.env.BBX_BOX_WORK);
    if (!parent?.maintenance || (await readPhase(directory))?.id !== parent.id) {
      throw new BoxMaintenanceError({ reason: "expired" });
    }
    const delegatedWork = await acquireBoxWork(boxRoot, { reason: `delegated ${opts.reason}`, inherited: JSON.stringify(parent) });
    const phase = async (value: Phase["phase"]): Promise<void> => {
      await validPermit(directory, JSON.stringify(parent));
      await writeFileAtomic(join(directory, "phase.json"), { content: JSON.stringify({ id: parent.id, reason: opts.reason, phase: value }) });
    };
    // Delegates only declare startup readiness explicitly; intermediate completion changes no phase.
    const noRelease = async (): Promise<void> => {};
    return { run: (fn) => context.run(parent, fn), drain: noRelease, release: () => delegatedWork.release(),
      prepare: () => phase("ready"), complete: noRelease, beginChanges: () => phase("exclusive") };
  }
  if (await validPermit(directory)) throw new BoxMaintenanceError({ reason: "nested" });
  const permit = { directory, id: randomUUID(), maintenance: true };
  try { await acquireLock(leasePath(permit), { id: permit.id, reason: opts.reason }); }
  catch (error) {
    if (error instanceof LockHeldError) throw ownerHeldError(error);
    throw error;
  }
  let changing = true;
  let completed = false;
  let released = false;
  const drainMs = opts.drainMs ?? 600_000;
  const writePhase = (phase: Phase["phase"]): Promise<void> => writeFileAtomic(join(directory, "phase.json"), {
    content: JSON.stringify({ id: permit.id, reason: opts.reason, phase, ...(phase === "draining" ? { until: new Date(Date.now() + drainMs).toISOString() } : {}) }),
  });
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    try {
      // A delegated docs/provisioning phase can mutate without calling this
      // handle's beginChanges. Its persisted phase is authoritative on failure.
      if (!changing && !completed) {
        const phase = await readPhase(directory);
        changing = phase !== null && phase.phase !== "draining";
      }
      if (completed || !changing) await rm(join(directory, "phase.json"), { force: true });
    }
    finally { await releaseLock(leasePath(permit)); }
  };
  try {
    const previous = await readPhase(directory);
    if (previous && previous.phase !== "draining" && !opts.recover) {
      changing = true;
      throw new BoxMaintenanceError({ reason: "recovery", detail: previous.reason });
    }
    // Retain a prior uncertain phase even if this recovery attempt cannot drain.
    changing = previous !== null && previous.phase !== "draining";
    await writePhase(changing ? "exclusive" : "draining");
    return {
      run: (fn) => context.run(permit, fn), release,
      async drain() {
        const deadline = Date.now() + drainMs;
        for (;;) {
          const live = await withAdmission(directory, () => scanLocks(join(directory, "work"), { suffix: ".lock", profile: "default" }));
          if (live.size === 0) return;
          if (Date.now() >= deadline) {
            const holders = [...live.values()].flatMap((holder) => holdersOf(holder.pid, holder));
            throw new BoxMaintenanceError({ reason: "timeout", detail: `${opts.reason}; held by ${describeWorkHolders(holders)}` });
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      },
      async prepare() {
        if (released) throw new BoxMaintenanceError({ reason: "expired" });
        await writePhase("ready"); changing = true;
      },
      async beginChanges() {
        if (released) throw new BoxMaintenanceError({ reason: "expired" });
        await writePhase("exclusive"); changing = true;
      },
      async complete() {
        await withAdmission(directory, async () => {
          invariant((await scanLocks(join(directory, "work"), { suffix: ".lock", profile: "default" })).size === 0, "Maintenance children must finish before reopening");
          completed = true;
          await release();
        });
      },
    };
  } catch (error) { await release(); throw error; }
}

/** Single-box callers close and drain in one operation. Fleets close all first. */
export async function acquireBoxMaintenance(boxRoot: string, opts: Parameters<typeof closeBoxMaintenance>[1]): Promise<BoxMaintenance> {
  const held = await closeBoxMaintenance(boxRoot, opts);
  try { await held.drain(); return held; }
  catch (error) { await held.release(); throw error; }
}

/** Startup may initialize a prepared generation; ordinary requests stay closed. */
export async function acquireBoxStartup(boxRoot: string): Promise<BoxWork> {
  const directory = await directoryFor(boxRoot);
  const phase = await readPhase(directory);
  if (!phase) return acquireBoxWork(boxRoot, { reason: "startup", inherited: null });
  if (phase.phase !== "ready") throw closedError(phase);
  return acquireBoxWork(boxRoot, { reason: "startup", inherited: JSON.stringify({ directory, id: phase.id, maintenance: true }) });
}
