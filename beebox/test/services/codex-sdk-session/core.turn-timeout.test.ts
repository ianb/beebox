// # Codex turn timeout
//
// Each Codex session caller states a wall-clock turn cap, or `null` for none.
// Chat turns have none: a person watches them and presses stop, and a long
// tool-heavy turn is normal work. A cap that ended such turns at ten minutes
// failed them with "Codex SDK turn did not complete before the timeout".
// Unattended agent runs keep their cap (`codex-agent.prompt-only.test.ts`).

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, eventually } from "@ianbicking/tap-check/check";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runCodexSdkTurn,
  type CodexSdkEvent,
  type CodexSdkSessionOptions,
  type CodexSdkThreadLike,
} from "../../../src/services/codex-sdk-session/core.js";
import type * as CodexChat from "../../../src/services/claude-chat/codex-chat.js";

/** A thread whose turn reports its id, then runs until its signal aborts. */
function runningThread(): CodexSdkThreadLike {
  return {
    id: "thread-1",
    runStreamed: async (_input, turnOptions) => {
      const signal = turnOptions?.signal;
      async function* events(): AsyncGenerator<CodexSdkEvent> {
        yield { type: "thread.started", thread_id: "thread-1" };
        await new Promise<void>((resolve) => {
          if (signal === undefined) return;
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new DOMException("aborted", "AbortError");
      }
      return { events: events() };
    },
  };
}

/** Run `body` while recording the delay of every timer it arms. */
async function armedTimers<T>(t: Test, body: () => Promise<T>): Promise<{ result: T; delays: unknown[] }> {
  const calls = t.capture(globalThis, "setTimeout", globalThis.setTimeout);
  try {
    const result = await body();
    return { result, delays: calls().map((call) => call.args[1]) };
  } finally {
    calls.restore();
  }
}

// ## The stop signal ends an uncapped turn
//
// With no cap, no timer is armed, and the caller's signal (the chat's stop
// button) is what ends the turn.
void test("The stop signal ends an uncapped turn", async (t) => {
  const stop = new AbortController();
  const { result, delays } = await armedTimers(t, () =>
    runCodexSdkTurn(runningThread(), {
      input: "work",
      turnTimeoutMs: null,
      signal: stop.signal,
      onSessionId: () => stop.abort(),
    }),
  );
  t.check(delays, []);
  t.check(result, {
    sessionId: "thread-1",
    output: "",
    resultText: "",
    durationMs: any(Number),
    status: "interrupted",
    error: "Codex turn was interrupted",
    usage: null,
    items: [],
  });
});

// ## A capped turn still times out
void test("A capped turn still times out", async (t) => {
  const { result, delays } = await armedTimers(t, () => runCodexSdkTurn(runningThread(), { input: "work", turnTimeoutMs: 20 }));
  t.check(delays, [20]);
  t.check(result, {
    sessionId: "thread-1",
    output: "",
    resultText: "",
    durationMs: any(Number),
    status: "failed",
    error: "Codex SDK turn did not complete before the timeout",
    usage: null,
    items: [],
  });
});

// ## The chat backend asks for no turn cap
void test("The chat backend asks for no turn cap", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "codex-chat-timeout-"));
  t.teardown(() => rm(cwd, { recursive: true, force: true }));
  const { createCodexChatBackend } = await t.mockImport<typeof CodexChat>(
    "../../../src/services/claude-chat/codex-chat.ts",
    { "../../../src/core/agent/ensure-codex-plugin.ts": { ensureCodexPluginInstalled: async () => {} } },
  );
  const seen: Array<CodexSdkSessionOptions["turnTimeoutMs"]> = [];
  const backend = createCodexChatBackend((options) => {
    seen.push(options.turnTimeoutMs);
    return { id: null, run: async () => { throw new Error("not run"); } };
  });
  const run = backend.start({ cwd, systemPrompt: "", env: {} });
  t.teardown(() => run.close());
  await eventually(() => seen.length > 0, { label: "the chat backend created its session" });
  t.check(seen, [null]);
});
