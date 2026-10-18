// # Quick chat record ids cannot name a path
//
// A quick chat record lives at `.beebox/quick-chat/<id>.json`, so the id the
// caller sends becomes part of a file path. Every procedure that takes an id
// accepts only a UUID: a path string is refused before any file is read or
// written. The behavior of each procedure is in `quick-chat.submit.doctest.md`.

import { test } from "tap";
import "agent-doctest/tap";
import { readdir } from "node:fs/promises";
import { TRPCError } from "@trpc/server";
import { quickChatRouter } from "../../../../src/webapp/trpc/routers/quick-chat.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

function caller(boxRoot: string) {
  const ctx: TrpcContext = trpcContext({ boxRoot, isAuthenticatedOwner: true, services: { jev: undefined } });
  return quickChatRouter.createCaller(ctx);
}
async function code(run: () => Promise<unknown>) {
  try { await run(); return "unexpected success"; }
  catch (error) { return error instanceof TRPCError ? error.code : String(error); }
}

void test("line 26", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L27
  const box = await makeTmpBox();
  const api = caller(box.root);
  t.check(
    [
      await code(() => api.submit({ id: "../escape", message: "Keep this" })),
      await code(() => api.choose({ id: "../../_config/box", candidateId: "c0" })),
      await code(() => api.discard({ id: "open/../x" })),
    ],
    [
    "BAD_REQUEST",
    "BAD_REQUEST",
    "BAD_REQUEST",
  ],
  );

  // doctest:L36
  t.check((await readdir(box.root, { recursive: true })).filter((entry) => entry.includes("quick-chat")), []);
});
