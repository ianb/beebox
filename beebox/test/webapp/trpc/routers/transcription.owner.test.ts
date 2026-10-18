// # Repointing the transcription backend is owner-only
//
// `setService` / `setHqService` decide which provider's key future transcriptions
// spend. Under `publicProcedure` any box-auth'd caller — a shared browser session,
// a paired device, a box agent holding the loopback token — could repoint the box
// onto a different backend; they are `ownerProcedure` now (secret-custody plan,
// Decision 6). Reading `config` stays public: the chat UI shows the current
// service to everyone who can see the chat.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import { readFile, rm } from "node:fs/promises";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { join } from "node:path";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { TRPCError } from "@trpc/server";
import { transcriptionRouter } from "../../../../src/webapp/trpc/routers/transcription.js";

/** A caller with the gate booleans denied by default; override per case. */
function caller(boxRoot: string, over: Partial<TrpcContext>) {
  const ctx: TrpcContext = trpcContext({ boxRoot, authed: false, isOwner: false, ...over });
  return transcriptionRouter.createCaller(ctx);
}

async function attempt(fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (e) {
    return `THREW:${e instanceof TRPCError ? e.code : String(e)}`;
  }
}

// ## An authenticated non-owner is refused, and nothing is written
void test("An authenticated non-owner is refused, and nothing is written", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await rm(boxRoot, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L37
  const fixtureBox = await makeTmpBox({ git: true });
  const boxRoot = fixtureBox.root;

  // doctest:L40
  print(await attempt(() => caller(boxRoot, { authed: true }).setService({ service: "deepgram" })));
  print(await attempt(() => caller(boxRoot, { authed: true }).setHqService({ hqService: "voxtral" })));
  const stillDefault = await caller(boxRoot, { authed: true }).config();
  await t.checkText(out.with(print(JSON.stringify(stillDefault))), `THREW:FORBIDDEN
THREW:FORBIDDEN
{"service":"voxtral","hqService":"whisper"}`);

  // ## The owner repoints it, and the change lands on disk

  // doctest:L53
  print(JSON.stringify(await caller(boxRoot, { isOwner: true }).setService({ service: "deepgram" })));
  print(JSON.stringify(await caller(boxRoot, { isOwner: true }).setHqService({ hqService: "voxtral-diarized" })));
  await t.checkText(out.with(print((await readFile(join(boxRoot, "_config/transcription.json"), "utf-8")).trim())), `{"service":"deepgram"}
{"hqService":"voxtral-diarized","warning":"This box has no key for voxtral-diarized yet; grant mistral in Admin → Secrets or it will fail on every pass."}
{
  "service": "deepgram",
  "hqService": "voxtral-diarized"
}`);
});
