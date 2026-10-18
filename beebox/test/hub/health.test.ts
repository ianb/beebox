// # Hub health verdict: idle is not broken, crash-loop is
//
// `src/hub/health.ts` derives the hub's `/healthz` verdict from per-box
// supervisor state. The whole point is the distinction the constant `status:
// "ok"` couldn't make (the 2026-07-16 better-sqlite3 ABI incident: every child
// crash-looping, `/healthz` green): a `stopped` box is a lazy hub's normal rest,
// a crash-looping one is a fault.
//
// The verdict is a pure function over `BoxRuntimeStatus[]`, so it's tested here
// directly — no server, no child. The route that serves it as 200/503 is covered
// in `hub-router.doctest.md`.

import { test } from "tap";
import "agent-doctest/tap";
import { isBoxBroken, hubVerdict } from "../../src/hub/health.js";
import type { BoxRuntimeStatus, BoxRunStatus } from "../../src/hub/box-status.js";

/** A `BoxRuntimeStatus` with the fields the verdict ignores defaulted, so each
 *  case states only what it's testing. */
function box(status: BoxRunStatus, extra?: Partial<BoxRuntimeStatus>): BoxRuntimeStatus {
  return { slug: "b", status, pid: undefined, port: undefined, restarts: 0, consecutiveFailures: 0, lastError: undefined, lastStart: undefined, ...extra };
}

// ## A running box is healthy; an idle (stopped) box is not a fault
void test("A running box is healthy; an idle (stopped) box is not a fault", async (t) => {
  // doctest:L27
  t.check(
    {
      running: isBoxBroken(box("running")),
      stopped: isBoxBroken(box("stopped")),
    },
    {
    running: false,
    stopped: false,
  },
  );
});

// ## A latched `unhealthy` box is broken; a crash-looping `starting` box is broken
//
// `starting` is broken only once it has already failed at least once — a first
// clean boot is `starting` with zero failures and is NOT a fault.
void test("starting is broken only once it has already failed at least once — a first cl...", async (t) => {
  // doctest:L40
  t.check(
    {
      unhealthy: isBoxBroken(box("unhealthy")),
      firstBoot: isBoxBroken(box("starting", { consecutiveFailures: 0 })),
      crashLooping: isBoxBroken(box("starting", { consecutiveFailures: 3 })),
    },
    {
    unhealthy: true,
    firstBoot: false,
    crashLooping: true,
  },
  );
});

// ## `restarts` (a lifetime counter) does NOT make a box broken
//
// The trap: a box that blipped and recovered long ago carries a high `restarts`
// but zero `consecutiveFailures` and is `running`. Keying the verdict on
// `restarts` would pin the hub red forever; keying on `consecutiveFailures`
// doesn't. This box is healthy.
void test("The trap:", async (t) => {
  // doctest:L56
  t.check(isBoxBroken(box("running", { restarts: 47, consecutiveFailures: 0 })), false);
});

// ## `hubVerdict`: unhealthy if ANY box is broken, else ok
//
// An all-idle fleet is `ok`. One crash-looping box among healthy ones makes the
// whole hub `unhealthy`.
void test("An all-idle fleet is ok.", async (t) => {
  // doctest:L66
  t.check(
    {
      empty: hubVerdict([]),
      allIdle: hubVerdict([box("stopped"), box("stopped"), box("running")]),
      oneBroken: hubVerdict([box("running"), box("unhealthy"), box("stopped")]),
    },
    {
    empty: "ok",
    allIdle: "ok",
    oneBroken: "unhealthy",
  },
  );
});
