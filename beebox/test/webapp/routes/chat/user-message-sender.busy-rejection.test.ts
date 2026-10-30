// # A send refused as busy leaves no record
//
// On 2026-10-14 two voice sends reached one idle chat 14 ms apart. Both passed
// the sender's busy check, because the first had not yet taken the turn. The
// sender recorded each as a user message and took its durable message-id claim,
// then the session refused the second as busy. The agent never got it, the
// dedup claim blocked a retry, and the chat page showed it as the newest message
// on every load
// (`issues/closed/bugs/2026-10-14-busy-rejected-send-recorded-then-orphaned.md`).
//
// The sender now records a message when the session takes its turn. A send the
// session refuses is answered `409` and leaves nothing behind: no
// `chat-user-message` event and no entry in `.beebox/message-dedup.json`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { anything, eventually } from "@ianbicking/tap-check/check";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BusEvent } from "../../../../src/core/event-bus/core.js";
import { makeTestServer } from "../../../helpers/test-route-server.js";
import { createFakeChatBackend, type FakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { getChatRuntime } from "../../../../src/webapp/chat-runtime.js";

async function dedupIds(boxRoot: string): Promise<string[]> {
  try {
    return Object.keys(JSON.parse(await readFile(join(boxRoot, ".beebox", "message-dedup.json"), "utf-8"))).toSorted();
  } catch (_e) {
    // No file means nothing was ever claimed — the expected state after a refusal.
    return [];
  }
}

/** The text of every message the engine was handed, across runs. */
function engineReceived(backend: FakeChatBackend): string[] {
  return backend.runs.flatMap((run) => run.sent.flatMap((blocks) => blocks.flatMap((b) => b.type === "text" ? [b.text] : [])));
}

// Both sends go to one resolved chat in the same tick, so each passes the busy
// check before either reaches the session. One takes the turn; the other is
// refused. Which one wins is up to the scheduler, so the result is sorted.
void test("Both sends go to one resolved chat in the same tick, so each passes the busy...", async (t) => {
  t.teardown(async () => {
    try {
      backend.lastRun()?.emitResult();
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const backend = createFakeChatBackend();
  const ctx = await makeTestServer({ chatBackend: backend });
  const recorded: string[] = [];
  ctx.eventBus.subscribe({
    listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(e.data.message); },
  });

  const runtime = getChatRuntime(ctx.boxRoot);
  if (runtime === undefined) throw new Error("chat runtime is not registered");
  const resolved = await runtime.resolveSendTarget({ sessionParam: "new", contextDir: undefined, requestSeedFeatures: undefined, exactSession: false });
  if (!resolved.ok) throw new Error(resolved.error);
  const send = (message: string, messageId: string) =>
    runtime.sendUserMessage({ target: resolved.target, message, messageId, user: null, channel: "ios-native" })
      .then((outcome) => ({ messageId, message, status: outcome.status, body: outcome.body }));

  const outcomes = (await Promise.all([send("feed the cat before noon", "long"), send("and water the ferns", "short")]))
    .toSorted((a, b) => a.status - b.status);
  t.check(outcomes.map((o) => [o.status, "turnId" in o.body ? "turnId" : o.body]), [
    [
      200,
      "turnId",
    ],
    [
      409,
      {
        error: "The chat is busy with another message; this one was not sent",
      },
    ],
  ]);

  // Only the admitted message is in history and in the dedup map. The run starts
  // behind a bootstrap git commit, so the waits below allow for a loaded host; they
  // bound a hang and do not measure latency.

  const [admitted, refused] = outcomes;
  if (admitted === undefined || refused === undefined) throw new Error("expected two send outcomes");
  await eventually(() => backend.runs.length === 1, { label: "the admitted send starts a run", timeoutMs: 120_000 });
  t.check(({ recorded, dedup: await dedupIds(ctx.boxRoot), admittedIsRecorded: recorded[0] === admitted.message, refusedId: refused.messageId, refusedInDedup: (await dedupIds(ctx.boxRoot)).includes(refused.messageId) }), {
    recorded: [
      anything(),
    ],
    dedup: [
      anything(),
    ],
    admittedIsRecorded: true,
    refusedId: anything(),
    refusedInDedup: false,
  });

  // The engine received the admitted message and never the refused one.

  await eventually(() => engineReceived(backend).length > 0, { label: "the engine receives the admitted message", timeoutMs: 120_000 });
  const received = engineReceived(backend).join("\n");
  t.check(({ admitted: received.includes(admitted.message), refused: received.includes(refused.message) }), {
    admitted: true,
    refused: false,
  });

  // Because no claim was taken, the refused id is not answered `deduplicated`
  // later. Once the turn ends, the same id is a new send that the chat accepts.

  backend.lastRun()?.emitResult();
  await eventually(() => !resolved.target.session.isBusy(), { label: "the first turn ends", timeoutMs: 120_000 });
  const again = await send(refused.message, refused.messageId);
  t.check([again.status, "turnId" in again.body ? "turnId" : again.body, recorded.length], [
    200,
    "turnId",
    2,
  ]);
});
