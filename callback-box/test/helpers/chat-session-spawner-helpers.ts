/**
 * Helpers for `test/chat-session-with-spawner.doctest.md`. Kept out of the
 * doctest itself because the doctest loader has trouble with top-level
 * function declarations that return inline object literals.
 */

import { once } from "node:events";
import type { ChatSession, ChatSessionOptions } from "../../src/core/chat-session.js";
import type { FakeChatBackend } from "../../src/services/claude-chat.js";

export async function setupSystemPrompt(): Promise<string> { return "setup"; }
export async function testPrompt(): Promise<string> { return "TEST PROMPT"; }
export async function testPromptShort(): Promise<string> { return "TEST"; }
export async function plainTestPrompt(): Promise<string> { return "test"; }

export const SETUP_FILE = "store/chats/x/.callback-box/current-session-setup.json";
export const MAIN_FILE = "store/chats/x/.callback-box/current-session-main.json";

export function buildSetupOpts(backend: FakeChatBackend): ChatSessionOptions {
  return { backend, systemPrompt: setupSystemPrompt, sessionFile: SETUP_FILE, skipBootstrap: true };
}

export function buildReopenSetupOpts(backend: FakeChatBackend): ChatSessionOptions {
  return { backend, sessionFile: SETUP_FILE, skipBootstrap: true };
}

export function buildReopenMainOpts(backend: FakeChatBackend): ChatSessionOptions {
  return { backend, sessionFile: MAIN_FILE, skipBootstrap: true };
}

export async function tick(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

/**
 * Wait until `backend.runs.length >= count`, or throw after `timeoutMs`.
 * Replaces fixed-tick waits in tests that watch for a new run to spawn —
 * `startRun` now has more async hops (lock file I/O, env build, optional
 * landmark contextDir lookup) than tick counts can reliably cover.
 */
export async function waitForRuns(
  backend: FakeChatBackend,
  { count, timeoutMs }: { count: number; timeoutMs: number },
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (backend.runs.length < count) {
    if (Date.now() > deadline) {
      throw new Error(`waitForRuns: expected ${count} run(s), got ${backend.runs.length} after ${timeoutMs}ms`);
    }
    await new Promise((r) => setImmediate(r));
  }
}

export async function runTurn(
  session: ChatSession,
  { backend, sessionIdToEmit }: { backend: FakeChatBackend; sessionIdToEmit: string },
): Promise<void> {
  await session.send("hi");
  await tick();
  // Register the "done" waiter BEFORE emitting — the fake delivers
  // synchronously, so `once` would miss the event if registered after.
  const done = once(session, "done");
  const run = backend.lastRun();
  if (run === null) throw new Error("runTurn: no run started");
  run.emitSessionInit(sessionIdToEmit);
  run.emitResult();
  await done;
}
