/**
 * A machine-wide semaphore around test runs: two slots for ordinary runs, both
 * slots for a `--tier careful` one, so careful tests run alone on an idle
 * machine.
 *
 * The pure decisions live here (staleness, slot choice) and the I/O that
 * applies them lives in {@link acquire} / {@link release} at the bottom — the
 * decisions are unit-testable without spawning a process or waiting a second.
 *
 * Why two slots, why a barrier, and what the ledger measured to justify both:
 * callback-box/docs/plans/change-based-test-selection.md, "Revision 2026-08-25
 * — test economics", mechanism A.
 */

import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

export type Tier = "ordinary" | "careful";

/** Slot names, fixed: the file set IS the semaphore's capacity. */
export const SLOTS = ["slot-0", "slot-1"] as const;

/** Marker a queued careful run leaves so ordinary runs stop taking freed slots. */
export const CAREFUL_WAITING = "careful-waiting";

/** Longer than any run could plausibly be, so a wedge is bounded even if its pid lives. */
export const LOCK_STALE_MS = 2 * 60 * 60 * 1000;

const POLL_MS = 1000;

export interface LockRecord {
  pid: number;
  branch: string;
  /** ISO time the lock was written. */
  at: string;
  /** The writer's boot time, or null where it is unknowable. */
  bootTimeMs: number | null;
}

export interface StaleProbe {
  nowMs: number;
  /** This machine's boot time now, or null when unknown. */
  bootTimeMs: number | null;
  isProcessAlive: (pid: number) => boolean;
}

/**
 * Is a held lock debris?
 *
 * Pid liveness alone wedges on pid reuse across a reboot — the kernel hands a
 * dead runner's pid to something unrelated and the slot is held forever. Two
 * facts about the RECORD settle that independently: a lock from before this
 * boot cannot belong to a running process, and one older than any run could be
 * is debris whatever the pid table says. Same hardening as `bin/schedules`'
 * run lock (bin/lib/schedules-store.ts).
 */
export function isLockStale(held: LockRecord, probe: StaleProbe): boolean {
  const atMs = Date.parse(held.at);
  if (Number.isNaN(atMs)) return true;
  if (probe.bootTimeMs !== null) {
    if (held.bootTimeMs !== null && held.bootTimeMs !== probe.bootTimeMs) return true;
    if (atMs < probe.bootTimeMs) return true;
  }
  if (probe.nowMs - atMs >= LOCK_STALE_MS) return true;
  return !probe.isProcessAlive(held.pid);
}

export interface SlotState {
  slot: string;
  /** The live holder, or null when the slot is free or holds only debris. */
  holder: LockRecord | null;
}

export interface Choice {
  /** Slots to claim, in order; empty when nothing can be claimed yet. */
  take: string[];
  /** Live runs already holding a slot — what the record's `concurrency` counts. */
  concurrency: number;
  /** Who to name in the one waiting line, when `take` is empty. */
  blockedBy: LockRecord | null;
}

/**
 * Which slots this run may claim right now.
 *
 * A careful run takes both or none. An ordinary run takes one free slot unless
 * a careful run is queued: while that marker stands, freed slots are reserved
 * for it, otherwise a steady stream of iteration runs starves it forever.
 */
export function chooseSlots(input: {
  tier: Tier;
  states: SlotState[];
  /** The live careful-waiting marker, if one stands (ignored for a careful run). */
  carefulWaiting: LockRecord | null;
}): Choice {
  const held = input.states.filter((s) => s.holder !== null);
  const free = input.states.filter((s) => s.holder === null).map((s) => s.slot);
  const concurrency = held.length;
  const blocked = (blockedBy: LockRecord | null): Choice => ({ take: [], concurrency, blockedBy });

  if (input.tier === "careful") {
    if (free.length < input.states.length) return blocked(held[0]?.holder ?? null);
    return { take: free, concurrency, blockedBy: null };
  }
  if (input.carefulWaiting !== null) return blocked(input.carefulWaiting);
  const first = free[0];
  if (first === undefined) return blocked(held[0]?.holder ?? null);
  return { take: [first], concurrency, blockedBy: null };
}

/** Parses a lock file's contents; null when it is unreadable or the wrong shape. */
export function parseLockRecord(raw: string): LockRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Partial<LockRecord>;
  if (typeof record.pid !== "number" || typeof record.branch !== "string") return null;
  if (typeof record.at !== "string") return null;
  const boot = record.bootTimeMs;
  if (typeof boot !== "number" && boot !== null && boot !== undefined) return null;
  return { pid: record.pid, branch: record.branch, at: record.at, bootTimeMs: boot ?? null };
}

/** `kill(pid, 0)`: EPERM means it exists and belongs to somebody else. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** When this machine booted, from `kern.boottime`; null off macOS or unparseable. */
export function bootTimeMs(): number | null {
  if (process.platform !== "darwin") return null;
  let raw: string;
  try {
    raw = execFileSync("/usr/sbin/sysctl", ["-n", "kern.boottime"], { encoding: "utf-8" });
  } catch {
    return null;
  }
  const match = /sec\s*=\s*(\d+)/u.exec(raw);
  const seconds = match?.[1];
  return seconds === undefined ? null : Number(seconds) * 1000;
}

// ── the I/O shell ───────────────────────────────────────────────────────────

export const lockDir = (gitCommonDir: string): string => join(gitCommonDir, "callback-test-locks");

/** A held claim; `release` is idempotent and safe to call from a signal handler. */
export interface Held {
  concurrency: number;
  release: () => void;
}

function probe(): StaleProbe {
  return { nowMs: Date.now(), bootTimeMs: bootTimeMs(), isProcessAlive };
}

/** Reads one lock file, deleting it when it holds debris. Null means "free". */
function readLive(path: string, staleProbe: StaleProbe): LockRecord | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const held = parseLockRecord(raw);
  if (held !== null && !isLockStale(held, staleProbe)) return held;
  // Debris: a killed run, a pre-boot leftover, or a half-written file.
  try {
    unlinkSync(path);
  } catch {
    // Someone else reclaimed it first; either way it is no longer ours to mind.
  }
  return null;
}

/** Writes a lock file, failing rather than overwriting — that failure IS the mutex. */
function claim(path: string, record: LockRecord): boolean {
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
  try {
    writeSync(fd, JSON.stringify(record));
  } finally {
    closeSync(fd);
  }
  return true;
}

/** Removes a lock file only when it is still ours — never another run's slot. */
function releaseOwn(path: string, pid: number): void {
  try {
    const held = parseLockRecord(readFileSync(path, "utf-8"));
    if (held !== null && held.pid !== pid) return;
    unlinkSync(path);
  } catch {
    // Already gone (reclaimed as stale, or released twice). Nothing to undo.
  }
}

/**
 * Take a slot, waiting quietly until one is available.
 *
 * Prints exactly one line when it has to wait and nothing at all when it does
 * not: this sits in front of every `pnpm test`, and an instrument that
 * narrates itself costs agent context on every run.
 */
export async function acquire(input: { dir: string; tier: Tier; branch: string }): Promise<Held> {
  mkdirSync(input.dir, { recursive: true });
  const self = process.pid;
  const markerPath = join(input.dir, CAREFUL_WAITING);
  let announced = false;
  let ownsMarker = false;

  for (;;) {
    const staleProbe = probe();
    const states = SLOTS.map((slot) => ({
      slot,
      holder: readLive(join(input.dir, slot), staleProbe),
    }));
    const marker = readLive(markerPath, staleProbe);
    const choice = chooseSlots({
      tier: input.tier,
      states,
      carefulWaiting: marker,
    });

    if (choice.take.length > 0) {
      const record: LockRecord = {
        pid: self,
        branch: input.branch,
        at: new Date().toISOString(),
        bootTimeMs: staleProbe.bootTimeMs,
      };
      const taken: string[] = [];
      for (const slot of choice.take) {
        if (!claim(join(input.dir, slot), record)) break;
        taken.push(slot);
      }
      if (taken.length === choice.take.length) {
        if (ownsMarker) releaseOwn(markerPath, self);
        return {
          concurrency: choice.concurrency,
          release: () => {
            for (const slot of taken) releaseOwn(join(input.dir, slot), self);
            if (ownsMarker) releaseOwn(markerPath, self);
          },
        };
      }
      // Lost a race for the second slot; give back the first and look again.
      for (const slot of taken) releaseOwn(join(input.dir, slot), self);
    } else if (input.tier === "careful" && marker === null) {
      // Queue the barrier before sleeping, so ordinary runs stop taking slots.
      ownsMarker = claim(markerPath, {
        pid: self,
        branch: input.branch,
        at: new Date().toISOString(),
        bootTimeMs: staleProbe.bootTimeMs,
      });
      continue;
    }

    if (!announced && choice.blockedBy !== null) {
      const by = choice.blockedBy;
      console.error(
        `test-ledger: waiting for slot (held by pid ${by.pid}, branch ${by.branch}, since ${by.at})`,
      );
      announced = true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
