// # Browse path classification
//
// Classification uses the actual filesystem and the same namespace fence as file
// reads. A dotted directory, extensionless file, and missing path stay distinct.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTestServer } from "../../../../helpers/test-route-server.js";
import { trpcContext } from "../../../../helpers/trpc-context.js";
import type { TrpcContext } from "../../../../../src/webapp/trpc/context.js";
import { filesRouter } from "../../../../../src/webapp/trpc/routers/files/router.js";

void test("line 15", async (t) => {
  t.teardown(async () => {
    try {
      await server.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const server = await makeTestServer();
  const ctx: TrpcContext = trpcContext({ boxRoot: server.boxRoot, boxSlug: "t", isAuthenticatedOwner: true });
  const caller = filesRouter.createCaller(ctx);
  await fs.mkdir(path.join(server.boxRoot, "_content/notes.attach"), { recursive: true });
  await server.seed("_content/README", "hello");
  t.check(await caller.kind({ path: "_content/notes.attach" }), {
    kind: "directory",
  });

  t.check(await caller.kind({ path: "_content/README" }), {
    kind: "file",
  });

  t.check(await caller.kind({ path: "_content/missing" }), {
    kind: "missing",
  });

  t.check(await caller.kind({ path: "" }), {
    kind: "directory",
  });

  await t.checkThrows(async () => (await caller.kind({ path: "_content/../package.json" })), "TRPCError: Path is outside the box namespace");

  await fs.symlink(server.boxRoot, path.join(server.boxRoot, "_content/escape"));
  await t.checkThrows(async () => (await caller.kind({ path: "_content/escape/package.json" })), "TRPCError: Path is outside the box namespace");
});
