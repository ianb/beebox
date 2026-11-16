// # The served frontend build, over the WebSocket
//
// The box server reads the identity from the index.html it would serve and
// `build.watch` yields it once when a subscription starts — which is every
// WebSocket connect and reconnect.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as path from "node:path";
import { readFrontendBuild } from "../../../../src/webapp/trpc/routers/build.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

void test("readFrontendBuild reads the stamped identity, and none from a missing or unstamped build", (t) => {
  const dir = t.testdir({
    stamped: { "index.html": "<html><head><meta name=\"bbx-frontend-build\" content=\"0123456789abcdef\"></head></html>" },
    unstamped: { "index.html": "<html><head></head></html>" },
  });
  t.check(readFrontendBuild(path.join(dir, "stamped")), "0123456789abcdef");
  t.check(readFrontendBuild(path.join(dir, "unstamped")), null);
  t.check(readFrontendBuild(path.join(dir, "absent")), null);
  t.end();
});

void test("build.watch yields the served identity, then stays open until the socket closes", async (t) => {
  const controller = new AbortController();
  const caller = appRouter.createCaller(trpcContext({ boxRoot: t.testdir(), frontendBuild: "0123456789abcdef" }), { signal: controller.signal });
  const frames = (await caller.build.watch())[Symbol.asyncIterator]();
  t.check(await frames.next(), { done: false, value: { frontend: "0123456789abcdef" } });
  const second = frames.next();
  controller.abort();
  t.check(await second, { done: true, value: undefined });
});
