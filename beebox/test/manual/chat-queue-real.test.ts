// # Chat queue draining — with real Claude
//
// Diagnoses: when a second user message is enqueued while a turn is in
// flight, does the backend actually drain it into a second turn?
//
// The fake-backend equivalent (`chat-session-with-spawner.doctest.md` →
// "Close handler drains queued messages into a fresh run") proves the
// in-process logic is correct. This file proves it against the real SDK,
// because user-visible bug reports (UI shows "Agent is busy — your
// message is queued" forever, second turn never completes) suggest
// something differs in the real path.
//
// Manual: spawns the `claude` SDK process, costs API calls, takes
// ~10–30 s. Run with `pnpm test:manual`.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import { ChatSession } from "../../src/core/chat/session/run/core.js";
import { createChatBackend } from "../../src/services/claude-chat/core.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

async function plainPrompt(): Promise<string> { return "Reply tersely."; }

/** Wait for `pred()` to be truthy or `timeoutMs` to elapse. */
async function waitFor({ pred, timeoutMs, label }: { pred: () => boolean; timeoutMs: number; label: string }): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

// ## Enqueue during a turn → second turn runs
//
// The flow:
//
// 1. Send "say A" — first turn starts, agent goes busy
// 2. While busy, `enqueue("say B")` — sits in messageQueue
// 3. First turn completes → handleMessage(result) calls drainQueue
// 4. drainQueue calls send → second turn starts → completes
// 5. Two `done` events fire; messageQueue is empty; session is idle
void test("The flow:", async (t) => {
  const out2 = printed();
  const print = out2.print;
  t.teardown(async () => {
    try {
      session.stop();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L46
  const box = await makeTmpBox();
  const backend = createChatBackend();
  const session = new ChatSession(box.root, {
    backend,
    systemPrompt: plainPrompt,
    skipBootstrap: true,
  });

  // doctest:L54
  const doneCount = { value: 0 };
  const lastResults: string[] = [];
  session.on("done", () => { doneCount.value += 1; });
  session.on("turn-text", (text: string) => { lastResults.push(text); });

  // doctest:L59
  print(`busy before send: ${session.isBusy()}`);
  await session.send("Say only the single word 'alpha' and nothing else.");
  print(`busy after send: ${session.isBusy()}`);

  // doctest:L63
  // Enqueue immediately — the first turn is in flight, so this should sit
  // in messageQueue until drainQueue picks it up.
  session.enqueue("Say only the single word 'beta' and nothing else.");
  print("queued (1 expected): «*»");

  // doctest:L68
  await waitFor({ pred: () => doneCount.value >= 2, timeoutMs: 60_000, label: "two turns to complete" });

  // doctest:L70
  print(`done events: ${doneCount.value}`);
  print(`busy after both: ${session.isBusy()}`);

  // doctest:L73
  // Show the agent's two replies for the human reader. We assert on
  // counts/shape, not on the text.
  const replies = lastResults.map((r) => `  reply: ${r.trim().slice(0, 80)}`).join("\n");
  await t.checkText(out2.with(print(replies)), `busy before send: false
busy after send: true
queued (1 expected): «*»
done events: 2
busy after both: false
«*»`);
});

// ## What the first test proves
//
// If the first test passes, the chat-session-layer queue logic works
// end-to-end against the real SDK. Bugs that look like "the agent never
// processed my second message" should then be hunted in the layers
// *above* the session: the HTTP route's enqueue path, the frontend's
// optimistic state, or the reconcile that drops pending messages once
// the server catches up. (`test/reconcile-pending.doctest.md` covers
// the reconcile in isolation.)
