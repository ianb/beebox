// # wakeup.start: the job check's wakeup, started by the box server
//
// The scheduler pass on a unit host is a short-lived unit, so it asks the box
// server to start the run (`wakeup.start`). The server answers once the child
// has taken the cycle lock, without waiting for the run; a second request while
// its run is in flight answers `running` and spawns nothing. Only the box's
// agent or its signed-in owner may ask. See docs/implemented-plans/on-demand-job-triggers.md,
// Track C.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { TRPCError } from "@trpc/server";
import { eventually, isoDate } from "@ianbicking/tap-check/check";
import { isRecord } from "../../../../src/shared/is-record.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import type { WakeupRunner } from "../../../../src/core/wakeup-runner.js";
import { boxLogFile } from "../../../../src/core/schedule/box-log.js";
import { readFile } from "node:fs/promises";

async function attempt(fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (e) {
    return `THREW:${e instanceof TRPCError ? e.code : String(e)}`;
  }
}

void test("The server answers on the acquired line, once per box at a time", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());

  // A child that takes the lock, then runs until the test lets it end.
  const end = Promise.withResolvers<void>();
  const calls: unknown[] = [];
  const wakeupRunner: WakeupRunner = async (opts) => {
    calls.push({ triggeredBy: opts.triggeredBy, maxCycles: opts.maxCycles });
    await Promise.resolve();
    opts.onChunk?.("[wakeup-cycle] acquired\n");
    await end.promise;
    return { ok: true, detail: "", output: "", outcome: null };
  };
  const caller = (over: Partial<TrpcContext>) =>
    appRouter.createCaller(trpcContext({ boxRoot: box.root, services: { wakeupRunner }, ...over }));
  const agent = caller({ actor: "agent", user: null, isOwner: false, isAuthenticatedOwner: false });

  const first = await agent.wakeup.start({ reason: "job-check" });
  const second = await agent.wakeup.start({ reason: "job-check" });
  t.check({ first, second, calls }, {
    first: { state: "started", detail: "" },
    second: { state: "running", detail: "A job-check wakeup is already in flight for this box." },
    calls: [{ triggeredBy: "job-check", maxCycles: 3 }],
  });

  // When the run ends, the server writes the run's end to the box's
  // scheduler log.
  end.resolve();
  const ended = await eventually(async () => {
    const last: unknown = JSON.parse((await readFile(boxLogFile(box.root), "utf-8")).trim().split("\n").at(-1) ?? "{}");
    return isRecord(last) && last.action === "run ended" ? last : null;
  }, { label: "run ended line" });
  t.check(ended, {
    ts: isoDate(),
    event: "job-check",
    action: "run ended",
    box: box.root,
    ok: true,
    jobsProcessed: null,
    jobsRemaining: null,
    detail: "",
  });

  // A member, a paired device, an open-access request, and an unauthenticated
  // caller are refused; the signed-in owner may ask.
  t.check(
    [
      await attempt(() => caller({ user: { email: "member@example.org", name: "Member" }, isOwner: false, isAuthenticatedOwner: false }).wakeup.start({ reason: "job-check" })),
      await attempt(() => caller({ actor: "device", isOwner: false, isAuthenticatedOwner: false }).wakeup.start({ reason: "job-check" })),
      await attempt(() => caller({ actor: "open", isAuthenticatedOwner: false }).wakeup.start({ reason: "job-check" })),
      await attempt(() => caller({ actor: "none", authed: false, isOwner: false, isAuthenticatedOwner: false }).wakeup.start({ reason: "job-check" })),
    ],
    ["THREW:FORBIDDEN", "THREW:FORBIDDEN", "THREW:FORBIDDEN", "THREW:UNAUTHORIZED"],
  );
});
