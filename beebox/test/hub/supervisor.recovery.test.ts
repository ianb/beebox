// # Supervisor recovery: a box that fails to start comes back without a human
//
// `src/hub/supervisor/core.ts` retries a failed start fast five times, then on a
// slow timer for as long as it takes. These tests cover that slow retry, a
// hub stopped during a launch, and a resident box refused by maintenance.

import { test, type Test } from "tap";
import { any, eventually, isoDate } from "@ianbicking/tap-check/check";
import "@ianbicking/tap-check/tap";
import { Supervisor } from "../../src/hub/supervisor/core.js";
import { makeFakeChild, type FakeChild } from "./support/fake-child.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { closeBoxMaintenance } from "../../src/lib/box-maintenance/admission.js";

/** A resident hub over one temporary box, with fake children. */
async function residentSupervisor(t: Test, opts: { pidBase: number; checkReady: () => Promise<void>; spawned?: () => void; unhealthyRetryMs?: number }) {
  const fixture = await makeTmpBox({ git: true });
  const children: FakeChild[] = [];
  const supervisor = new Supervisor({
    config: { port: undefined, host: undefined, boxes: { fixture: { path: fixture.root } }, configPath: fixture.path("hub.json"), lazy: false, idleMs: 300_000, keepRecent: 0 },
    hubSecret: "test-hub-secret",
    spawnChild() {
      const child = makeFakeChild(opts.pidBase + children.length);
      children.push(child);
      opts.spawned?.();
      return child;
    },
    checkReady: opts.checkReady,
    baseBackoffMs: 1,
    unhealthyRetryMs: opts.unhealthyRetryMs ?? 600_000,
  });
  t.teardown(async () => {
    try {
      await supervisor.stopAll();
      await fixture.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  return { fixture, children, supervisor };
}

// ## An unhealthy box keeps retrying until it starts
//
// On 2026-10-25 a box's restarts failed five times in a minute on a lock that
// cleared five minutes later, and the box stayed down until a human sent
// SIGHUP. The boxholder: a box child that crashes must come back without a
// human. After the fast retries the box is unhealthy and retried on a slow
// timer, which here is 20 ms.
void test("An unhealthy box keeps retrying until it starts", async (t) => {
  const failuresSeen: number[] = [];
  const { supervisor } = await residentSupervisor(t, {
    pidBase: 970000,
    unhealthyRetryMs: 20,
    checkReady() {
      failuresSeen.push(supervisor.getStatuses()[0]?.consecutiveFailures ?? -1);
      return failuresSeen.length <= 6 ? Promise.reject(new Error("simulated lock held")) : Promise.resolve();
    },
  });
  await supervisor.startAll();
  await eventually(() => supervisor.getStatuses()[0]?.status === "running", { label: "box started on a slow retry", timeoutMs: 30_000 });
  // Five fast attempts, then two slow ones: the sixth and seventh launches ran
  // with the failure count past the limit.
  t.check(failuresSeen, [0, 1, 2, 3, 4, 5, 6]);
  t.check(supervisor.getStatuses()[0], {
    slug: "fixture",
    status: "running",
    pid: 970006,
    port: any(Number),
    restarts: 6,
    consecutiveFailures: 0,
    lastError: undefined,
    lastStart: { at: isoDate(), spawnMs: any(Number), readyMs: any(Number) },
  });
});

// ## A hub stopped during a launch leaves no child running
//
// `stopAll()` kills only the children it knows about. A launch still spawning
// when the hub stops must kill its own child, not mark the box running.
void test("A hub stopped during a launch leaves no child running", async (t) => {
  const { supervisor } = await residentSupervisor(t, {
    pidBase: 980000,
    spawned() { void supervisor.stopAll(); },
    checkReady: () => Promise.resolve(),
  });
  await supervisor.startAll();
  t.check(supervisor.getStatuses()[0], {
    slug: "fixture",
    status: "stopped",
    pid: undefined,
    port: undefined,
    restarts: 0,
    consecutiveFailures: 0,
    lastError: undefined,
    lastStart: undefined,
  });
});

// ## A resident box refused by maintenance starts once maintenance ends
//
// A refusal is not a crash, so it uses none of the failure budget. A lazy hub
// starts the box on its next request; a resident hub has no request coming, so
// it retries when the closure expects to reopen.
void test("A resident box refused by maintenance starts once maintenance ends", async (t) => {
  const { fixture, supervisor } = await residentSupervisor(t, { pidBase: 990000, checkReady: () => Promise.resolve() });
  const maintenance = await closeBoxMaintenance(fixture.root, { reason: "test upgrade", drainMs: 10 });
  await supervisor.startAll();
  t.check(supervisor.getStatuses()[0], {
    slug: "fixture",
    status: "stopped",
    pid: undefined,
    port: undefined,
    restarts: 0,
    consecutiveFailures: 0,
    lastError: "Box is closed for test upgrade; expected to reopen within 1 min",
    lastStart: undefined,
  });

  await maintenance.release();
  await eventually(() => supervisor.getStatuses()[0]?.status === "running", { label: "box started after maintenance", timeoutMs: 30_000 });
  t.check(supervisor.getStatuses()[0]?.consecutiveFailures, 0);
});
