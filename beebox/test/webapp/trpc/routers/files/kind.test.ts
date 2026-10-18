// # Browse path classification
//
// Classification uses the actual filesystem and the same namespace fence as file
// reads. A dotted directory, extensionless file, and missing path stay distinct.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTestServer } from "../../../../helpers/doctest-server.js";
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
  // doctest:L16
  const server = await makeTestServer();
  const ctx: TrpcContext = trpcContext({ boxRoot: server.boxRoot, boxSlug: "t", isAuthenticatedOwner: true });
  const caller = filesRouter.createCaller(ctx);
  await fs.mkdir(path.join(server.boxRoot, "_content/notes.attach"), { recursive: true });
  await server.seed("_content/README", "hello");
  t.check(await caller.kind({ path: "_content/notes.attach" }), {
    kind: "directory",
  });

  // doctest:L24
  t.check(await caller.kind({ path: "_content/README" }), {
    kind: "file",
  });

  // doctest:L27
  t.check(await caller.kind({ path: "_content/missing" }), {
    kind: "missing",
  });

  // doctest:L30
  t.check(await caller.kind({ path: "" }), {
    kind: "directory",
  });

  // doctest:L33
  await t.checkThrows(async () => (await caller.kind({ path: "_content/../package.json" })), "TRPCError: Path is outside the box namespace");

  // doctest:L38
  await fs.symlink(server.boxRoot, path.join(server.boxRoot, "_content/escape"));
  await t.checkThrows(async () => (await caller.kind({ path: "_content/escape/package.json" })), "TRPCError: Path is outside the box namespace");
});
