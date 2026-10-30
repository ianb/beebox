// # Idle exit: the decision
//
// `decideIdle` is the whole rule a socket-activated box uses to stop itself
// (`src/webapp/server/idle-exit.ts`). Each signal that keeps the box up is
// shown holding on its own; the exit happens only with every signal quiet and
// the idle window elapsed.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fastify from "fastify";
import { ActivityLedger, decideIdle, type IdleSignals } from "../../../src/webapp/server/idle-exit.js";
import { runBbxWakeup } from "../../../src/core/commands/wakeup.js";

const quiet: IdleSignals = { lastActivityAt: 0, inFlight: 0, openSockets: 0, liveRuns: 0, pendingSchedules: 0 };
const clock = { now: 10_000, idleMs: 5_000 };

void test("every signal keeps the box up on its own, in priority order", async (t) => {
  t.check(decideIdle({ ...quiet, inFlight: 1, openSockets: 2, liveRuns: 1, pendingSchedules: 1 }, clock), { exit: false, keptBy: "in-flight" });
  t.check(decideIdle({ ...quiet, openSockets: 1 }, clock), { exit: false, keptBy: "open-sockets" });
  t.check(decideIdle({ ...quiet, liveRuns: 1 }, clock), { exit: false, keptBy: "live-runs" });
  // An overdue schedule still fires from this process, so it counts like a future one.
  t.check(decideIdle({ ...quiet, pendingSchedules: 1 }, clock), { exit: false, keptBy: "pending-schedules" });
  t.check(decideIdle({ ...quiet, lastActivityAt: 6_000 }, clock), { exit: false, keptBy: "recent-activity" });
});

void test("quiet for the whole window exits; one millisecond short does not", async (t) => {
  t.check(decideIdle({ ...quiet, lastActivityAt: 5_000 }, clock), { exit: true });
  t.check(decideIdle({ ...quiet, lastActivityAt: 5_001 }, clock), { exit: false, keptBy: "recent-activity" });
});

// A wakeup child this process spawned (the job check's, scan's, filing's, or a
// forced one) counts as a live run, so the server does not drain under it. The
// child here runs in a directory that is not a box and fails at once; while
// the server waits on it, the ledger counts it.
void test("a live wakeup child keeps the box up", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bbx-idle-wakeup-"));
  const server = fastify();
  t.teardown(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const ledger = new ActivityLedger({ server, boxes: [], now: () => 0 });

  const run = runBbxWakeup({ boxRoot: dir, triggeredBy: "test" });
  const during = decideIdle(ledger.signals(), clock);
  await run;
  t.check({ during, after: decideIdle(ledger.signals(), clock) }, {
    during: { exit: false, keptBy: "live-runs" },
    after: { exit: true },
  });
});
