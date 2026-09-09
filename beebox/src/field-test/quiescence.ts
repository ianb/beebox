/**
 * Box quiescence — "has everything this activity kicked off actually finished?"
 * (`docs/plans/agent-field-tests.md`, Track 2).
 *
 * The harness waits here between an operator activity and the item's hard
 * checks, and before every `pre` action, so a check never races the reactor and
 * a day advance never restarts the server over in-flight agent work.
 *
 * It is a COMPOSITE on purpose. `chat.status` reports one session and answers
 * *idle* for an id it has never heard of, so no single signal can say "the box
 * is quiet". Three independent things must all be true:
 *
 *   chat  — no live chat session is mid-turn (`chat.statusAll`, over HTTP with
 *           the run's diagnostic key: chat sessions live in the SERVER process,
 *           so this is the one component the harness cannot read off disk)
 *   jobs  — no `*.job.card` is pending under `_bookkeeping/jobs/`, background
 *           maintenance aside (see `BACKGROUND_JOB_TYPES`)
 *   bulk  — no bulk-upload batch is between sealed and delivered
 *
 * When the budget runs out, which component was still busy is the finding — a
 * timeout that only said "not quiescent" would leave every run's triage to
 * start from scratch.
 */

import { z } from "zod";
import { findJobCards } from "../core/reactor/job-discovery.js";
import { listStagingSessions } from "../core/capture/staging-store.js";
import { isBulkSession } from "../core/capture/staging-schema.js";
import { startAwakeTimeout } from "../lib/awake-timeout.js";
import { sleep } from "../lib/sleep.js";
import { errorMessage } from "../lib/error-guards.js";
import { getBoxDir } from "../lib/paths.js";

/** Bulk-upload states that mean the box still owes the batch work. `open` is
 *  deliberately excluded: an open batch is waiting on the *uploader*, and an
 *  operator who wandered off mid-upload would otherwise hang every later item
 *  until the hour-long abandonment sweep. */
const BULK_IN_FLIGHT: ReadonlySet<string> = new Set(["sealed", "preparing", "delivering"]);

export interface ProbeReading {
  busy: boolean;
  /** What was busy (or what went wrong), for the run report. Null when idle. */
  detail: string | null;
}

export interface QuiescenceProbe {
  /** Short component name; appears in the report when a wait times out. */
  name: string;
  read(): Promise<ProbeReading>;
}

export interface QuiescenceOutcome {
  quiescent: boolean;
  waitedMs: number;
  /** Components still busy when the budget ran out. Empty when quiescent. */
  stuck: { name: string; detail: string | null }[];
}

const StatusAllSchema = z.object({
  result: z.object({
    data: z.object({
      busy: z.boolean(),
      sessions: z.array(
        z.object({ sessionId: z.string().nullable(), running: z.boolean(), busy: z.boolean() }),
      ),
    }),
  }),
});

/** Chat sessions, read from the run server over the diagnostic key. */
function chatProbe(opts: { baseUrl: string; diagKey: string }): QuiescenceProbe {
  const url = `${opts.baseUrl}/api/trpc/chat.statusAll`;
  return {
    name: "chat",
    async read(): Promise<ProbeReading> {
      let payload: unknown;
      try {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${opts.diagKey}` } });
        if (response.status !== 200) {
          await response.text();
          return { busy: true, detail: `chat.statusAll answered HTTP ${String(response.status)}` };
        }
        payload = await response.json();
      } catch (e) {
        // Unreachable is NOT idle: the server may be mid-restart, and calling
        // that quiet would let a check run against a box still being written.
        return { busy: true, detail: `chat.statusAll unreachable (${errorMessage(e)})` };
      }
      const parsed = StatusAllSchema.safeParse(payload);
      if (!parsed.success) return { busy: true, detail: "chat.statusAll returned an unreadable body" };
      const { busy, sessions } = parsed.data.result.data;
      if (!busy) return { busy: false, detail: null };
      const names = sessions.filter((s) => s.busy).map((s) => s.sessionId ?? "(new session)");
      return { busy: true, detail: `chat session(s) mid-turn: ${names.join(", ")}` };
    },
  };
}

/**
 * Background-maintenance job types every wakeup queues and only the NEXT full
 * wakeup drains. They are not work the activity kicked off, and waiting on them
 * would time out at every single item: a connector-scoped wakeup scopes its
 * reactor to that connector's jobs, so a backfill job queued during an email
 * injection is still sitting there when the wait begins.
 */
const BACKGROUND_JOB_TYPES: readonly string[] = ["contains-backfill", "todo-review"];

function isBackgroundJob(file: string): boolean {
  return BACKGROUND_JOB_TYPES.some((type) => file.endsWith(`.${type}.job.card`));
}

/** Pending reactor job cards under `_bookkeeping/jobs/`, background maintenance aside. */
function jobsProbe(boxRoot: string): QuiescenceProbe {
  const jobsDir = getBoxDir(boxRoot, "jobs");
  return {
    name: "jobs",
    async read(): Promise<ProbeReading> {
      const jobs = (await findJobCards(jobsDir)).filter((job) => !isBackgroundJob(job.file));
      if (jobs.length === 0) return { busy: false, detail: null };
      return { busy: true, detail: `${String(jobs.length)} pending job card(s): ${jobs.map((j) => j.file).join(", ")}` };
    },
  };
}

/** Bulk-upload batches the box has taken responsibility for but not finished. */
function bulkUploadProbe(boxRoot: string): QuiescenceProbe {
  return {
    name: "bulk-upload",
    async read(): Promise<ProbeReading> {
      const sessions = await listStagingSessions({ boxRoot });
      const inFlight = sessions.filter((s) => isBulkSession(s) && BULK_IN_FLIGHT.has(s.state));
      if (inFlight.length === 0) return { busy: false, detail: null };
      return {
        busy: true,
        detail: `bulk batch(es) in flight: ${inFlight.map((s) => `${s.id} (${s.state})`).join(", ")}`,
      };
    },
  };
}

/** The three probes a field run always waits on. */
export function boxQuiescenceProbes(opts: {
  boxRoot: string;
  baseUrl: string;
  diagKey: string;
}): QuiescenceProbe[] {
  return [
    chatProbe({ baseUrl: opts.baseUrl, diagKey: opts.diagKey }),
    jobsProbe(opts.boxRoot),
    bulkUploadProbe(opts.boxRoot),
  ];
}

export interface WaitForQuiescenceOptions {
  probes: readonly QuiescenceProbe[];
  /** Awake-time budget for the whole wait. */
  timeoutMs: number;
  /** Gap between polls. */
  pollMs: number;
  /**
   * Once everything reads idle, wait this long and read again. A job card is
   * deleted before its successor is written, so a single all-idle reading can
   * land in the gap between two stages of the same cycle.
   */
  settleMs: number;
}

/**
 * Poll until every probe reads idle twice, `settleMs` apart, or the awake-time
 * budget expires. Never throws: a timeout is a recorded finding (which
 * component was stuck), because the run continues either way.
 */
export async function waitForQuiescence(options: WaitForQuiescenceOptions): Promise<QuiescenceOutcome> {
  const { probes, timeoutMs, pollMs, settleMs } = options;
  const startedAt = Date.now();
  const budget = { expired: false };
  const timer = startAwakeTimeout({
    timeoutMs,
    periodMs: Math.min(pollMs, 5_000),
    onTimeout: () => {
      budget.expired = true;
    },
  });

  // A probe that throws (a torn read of a staging manifest, a directory that
  // vanished mid-scan) reads as BUSY with the error as its detail. It must not
  // escape: `waitForQuiescence` is the one step of the item loop whose whole
  // contract is "record what stayed busy and continue", and a throw here would
  // surface as the run aborting at that item.
  const readOne = async (probe: QuiescenceProbe): Promise<ProbeReading> => {
    try {
      return await probe.read();
    } catch (e) {
      return { busy: true, detail: `${probe.name} probe failed: ${errorMessage(e)}` };
    }
  };

  const readAll = async (): Promise<{ name: string; detail: string | null }[]> => {
    const readings = await Promise.all(probes.map(async (probe) => ({ probe, reading: await readOne(probe) })));
    return readings
      .filter(({ reading }) => reading.busy)
      .map(({ probe, reading }) => ({ name: probe.name, detail: reading.detail }));
  };

  try {
    let busy = await readAll();
    while (!budget.expired) {
      if (busy.length === 0) {
        await sleep(settleMs);
        busy = await readAll();
        if (busy.length === 0) {
          return { quiescent: true, waitedMs: Date.now() - startedAt, stuck: [] };
        }
        continue;
      }
      await sleep(pollMs);
      busy = await readAll();
    }
    // Budget gone. A last reading that happens to be idle still counts as
    // quiescent — reporting "not quiescent, nothing stuck" would be a finding
    // nobody could act on.
    return { quiescent: busy.length === 0, waitedMs: Date.now() - startedAt, stuck: busy };
  } finally {
    timer.stop();
  }
}
