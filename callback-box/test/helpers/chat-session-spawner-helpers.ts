/**
 * Helpers for `test/chat-session-with-spawner.doctest.md`. Kept out of the
 * doctest itself because the doctest loader has trouble with top-level
 * function declarations that return inline object literals.
 */

import { once } from "node:events";
import type { ChatSession, ChatSessionOptions } from "../../src/core/chat-session.js";
import type { FakeClaudeChatSpawner } from "../../src/services/claude-chat.js";

export async function setupSystemPrompt(): Promise<string> { return "setup"; }
export async function mainSystemPrompt(): Promise<string> { return "main"; }
export async function testPrompt(): Promise<string> { return "TEST PROMPT"; }
export async function testPromptShort(): Promise<string> { return "TEST"; }
export async function xPrompt(): Promise<string> { return "x"; }
export async function plainTestPrompt(): Promise<string> { return "test"; }

export const SETUP_FILE = "store/activities/poly/x/.callback-box/current-session-setup.json";
export const MAIN_FILE = "store/activities/poly/x/.callback-box/current-session-main.json";

export function buildSetupOpts(spawner: FakeClaudeChatSpawner): ChatSessionOptions {
  return { spawner, systemPrompt: setupSystemPrompt, sessionFile: SETUP_FILE, skipBootstrap: true };
}

export function buildMainOpts(spawner: FakeClaudeChatSpawner): ChatSessionOptions {
  return { spawner, systemPrompt: mainSystemPrompt, sessionFile: MAIN_FILE, skipBootstrap: true };
}

export function buildReopenSetupOpts(spawner: FakeClaudeChatSpawner): ChatSessionOptions {
  return { spawner, sessionFile: SETUP_FILE, skipBootstrap: true };
}

export function buildReopenMainOpts(spawner: FakeClaudeChatSpawner): ChatSessionOptions {
  return { spawner, sessionFile: MAIN_FILE, skipBootstrap: true };
}

export async function tick(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

export async function runTurn(
  session: ChatSession,
  { spawner, sessionIdToEmit }: { spawner: FakeClaudeChatSpawner; sessionIdToEmit: string },
): Promise<void> {
  await session.send("hi");
  await tick();
  // Register the "done" waiter BEFORE emitting — PassThrough may deliver
  // synchronously, in which case `once` would miss the event if registered after.
  const done = once(session, "done");
  const proc = spawner.lastProcess();
  if (proc === null) throw new Error("runTurn: no process spawned");
  proc.emitSessionInit(sessionIdToEmit);
  proc.emitResult();
  await done;
}
