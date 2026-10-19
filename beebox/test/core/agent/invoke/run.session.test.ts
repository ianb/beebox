// # Agent session id plumbing
//
// Tests for `createAgent`'s session-id handling (`src/core/agent/invoke/core.ts` →
// `src/core/agent/invoke/run.ts`). The chat reactor pre-mints a session id
// (`chat-reactor-sessions.ts`) and stores it in
// `.beebox/chat-sessions.json`; for that stored id to be resumable in a
// later reactor cycle, the *first* run must hand it to the SDK as the
// create-with-id `sessionId` option. This was silently dropped in the
// 2026-05 SDK migration (the minted id never reached the SDK, so every
// resume failed with "No conversation found"); these tests pin the plumbing.
//
// The dry-run path reports the session id the run would use, which lets us
// assert the plumbing without spawning the SDK.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createAgent } from "../../../../src/core/agent/invoke/core.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

const MINTED = "11111111-1111-4111-8111-111111111111";

// ## Pre-minted id reaches the first (fresh) run as create-with-id
void test("Pre-minted id reaches the first (fresh) run as create-with-id", async (t) => {
  // doctest:L25
  const box = await makeTmpBox();
  const agent = createAgent({ name: "test", sessionId: MINTED });

  // doctest:L28
  const first = await agent.invoke({ boxRoot: box.root, prompt: "hi", dryRun: true });
  t.check(first, { success: true, output: "[DRY RUN] Would run Claude via SDK with prompt:\nhi", exitCode: 0, sessionId: MINTED });

  // The second invoke on the same agent resumes that same id:

  // doctest:L36
  const second = await agent.invoke({ boxRoot: box.root, prompt: "again", dryRun: true });
  t.check(second, { success: true, output: "[DRY RUN] Would run Claude via SDK with prompt:\nagain", exitCode: 0, sessionId: MINTED });

  // doctest:L40
  await box.cleanup();
});

// ## resume: true resumes the given id from the first invoke
void test("resume: true resumes the given id from the first invoke", async (t) => {
  // doctest:L46
  const box = await makeTmpBox();
  const agent = createAgent({ name: "test", sessionId: MINTED, resume: true });

  // doctest:L49
  const run = await agent.invoke({ boxRoot: box.root, prompt: "hi", dryRun: true });
  t.check(run, { success: true, output: "[DRY RUN] Would run Claude via SDK with prompt:\nhi", exitCode: 0, sessionId: MINTED });

  // doctest:L53
  await box.cleanup();
});

// ## Without a pre-minted id the SDK assigns one (unknown before the run)
void test("Without a pre-minted id the SDK assigns one (unknown before the run)", async (t) => {
  // doctest:L59
  const box = await makeTmpBox();
  const agent = createAgent({ name: "test" });

  // doctest:L62
  const run = await agent.invoke({ boxRoot: box.root, prompt: "hi", dryRun: true });
  t.check(run, { success: true, output: "[DRY RUN] Would run Claude via SDK with prompt:\nhi", exitCode: 0, sessionId: "" });

  // doctest:L66
  t.check(agent.sessionId, null);

  // doctest:L69
  await box.cleanup();
});
