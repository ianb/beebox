// `debugLog.submit` keeps the frontend's runtime-lint entries (source
// `runtime-lint`) only on a server that turned them on: every dev box
// (`devSurfaces`) and a hosted deployment with BBX_RUNTIME_LINT=1
// (`startServer` calls setRuntimeLintWriting). Elsewhere it accepts and drops
// them, so the client needs no setting of its own. Other sources are written
// either way. Plan: docs/implemented-plans/runtime-lint.md, Track 1.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate, str } from "@ianbicking/tap-check/check";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { setRuntimeLintWriting } from "../../../../src/webapp/trpc/routers/debug-log.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

const LOG_PATH = ".beebox/client-debug.log";
const LINE = "content-replaced surface=card-body content=c1 gapMs=0";

async function submitBoth(t: Test, writing: boolean) {
  setRuntimeLintWriting(writing);
  const box = await makeTmpBox({ git: true });
  t.teardown(async () => {
    setRuntimeLintWriting(false);
    await box.cleanup();
  });
  const c = appRouter.createCaller(trpcContext({ boxRoot: box.root, isAuthenticatedOwner: true }));
  await c.debugLog.submit({ source: "runtime-lint", entries: [{ level: "warn", message: LINE }] });
  await c.debugLog.submit({ entries: [{ level: "error", message: "Something broke" }] });
  return (await box.read(LOG_PATH)).trim().split("\n");
}

void test("with runtime lint on, its entries are written under their source", async (t) => {
  t.check(await submitBoth(t, true), [
    str`${isoDate()} [warn] [runtime-lint] ${LINE}`,
    str`${isoDate()} [error] Something broke`,
  ]);
});

void test("with runtime lint off, its entries are dropped and others are written", async (t) => {
  t.check(await submitBoth(t, false), [str`${isoDate()} [error] Something broke`]);
});
