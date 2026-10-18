// # Pending session identity observer
//
// The Siri landing introduced a ten-minute bound on pending identity listeners.
// That cleanup timer must not keep a finished process alive: the capture-resume
// fixture completed its assertions but timed out waiting for Node to exit.

import { test } from "tap";
import "agent-doctest/tap";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { observeAssignedSession } from "../../../../src/core/chat/session/deliver-user-message.js";
import { ChatSession } from "../../../../src/core/chat/session/run/core.js";
import { ChatSessionRegistry } from "../../../../src/core/chat/session/registry/core.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";

const exec = promisify(execFile);

// A child arms the real observer for an unassigned session, without detaching it.
// It exits normally within the test budget instead of waiting ten minutes.
void test("A child arms the real observer for an unassigned session, without detaching it.", async (t) => {
  t.teardown(async () => {
    try {
      detach();
      await registry.shutdown();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L22
  const box = await makeTmpBox();
  const script = `
import { observeAssignedSession } from './src/core/chat/session/deliver-user-message.ts';
import { ChatSessionRegistry } from './src/core/chat/session/registry/core.ts';
import { createFakeChatBackend } from './src/services/claude-chat/core.ts';
const registry = new ChatSessionRegistry(process.argv[1], { backend: createFakeChatBackend() });
const session = registry.createNew();
observeAssignedSession({ registry, session, onAssigned: () => { throw new Error('Unexpected assignment'); }, logPrefix: 'test' });
console.log('pending:' + registry.listenerCount('session-assigned'));
`;
  const child = await exec(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, box.root], { timeout: 10_000 });
  t.check(child.stdout.trim().split("\n").at(-1), "pending:1");

  // The observer still ignores unrelated assignments, persists the matching ID
  // once, and removes its listener after that assignment.

  // doctest:L41
  const registry = new ChatSessionRegistry(box.root, { backend: createFakeChatBackend() });
  const session = new ChatSession(box.root, { backend: createFakeChatBackend(), sessionFile: null, initialSessionId: "target" });
  const assigned: string[] = [];
  const detach = observeAssignedSession({ registry, session, onAssigned: (id) => { assigned.push(id); }, logPrefix: "test" });
  registry.emit("session-assigned", { sessionId: "other" });
  t.check(assigned, []);

  // doctest:L49
  registry.emit("session-assigned", { sessionId: "target" });
  registry.emit("session-assigned", { sessionId: "target" });
  t.check(assigned, [
    "target",
  ]);

  // doctest:L54
  t.check(registry.listenerCount("session-assigned"), 0);
});
