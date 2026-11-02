// # An interrupted chat wakes itself
//
// When a chat's run was interrupted from outside while background tasks were
// live (box maintenance, a server shutdown or crash, the agent process dying),
// the server starts one turn in that chat so the agent decides about the
// unfinished work (`docs/plans/interrupted-chat-wake.md`). A hung run or an
// ending someone asked for does not wake; neither does a chat with no wake left
// today, a chat whose run is still live, or any chat while maintenance holds
// the box. `createInterruptedWakePass` is one poll pass
// (`src/webapp/routes/chat/interrupted-wake.ts`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createInterruptedWakePass } from "../../../../src/webapp/routes/chat/interrupted-wake.js";
import { ChatSessionRegistry } from "../../../../src/core/chat/session/registry/core.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { createEventBus } from "../../../../src/core/event-bus/core.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import { acquireChatActiveLock } from "../../../../src/core/schedule/state.js";
import { closeBoxMaintenance } from "../../../../src/lib/box-maintenance/admission.js";
import { makeTmpBox, type TmpBox } from "../../../helpers/test-helpers.js";
import { waitForRuns, plainTestPrompt } from "../../../helpers/chat-session-spawner-helpers.js";

const SESSION = "11111111-1111-4111-8111-111111111111";
const NOTE = `.beebox/chat-run-ended/${SESSION}.json`;
const MAINTENANCE = { tasks: ["collect sources"], lastSeenAt: "2026-11-02T20:00:00.000Z", writer: "earlier-server", at: "2026-11-02T20:00:00.000Z", cause: "box maintenance (deployment)", wake: true };

async function setup(t: { teardown(fn: () => Promise<void> | void): void }) {
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const registry = new ChatSessionRegistry(box.root, { backend, buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }) });
  const eventBus = createEventBus(box.root);
  t.teardown(async () => { await registry.shutdown(); eventBus.close(); await box.cleanup(); });
  const logPath = getSessionLogPath(box.root, SESSION);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, "{}\n");
  const pass = createInterruptedWakePass({ boxRoot: box.root, registry, eventBus, wireSession: () => {} });
  return { box, backend, pass };
}

async function notes(box: TmpBox): Promise<unknown> {
  const listed = await box.list(".beebox/chat-run-ended");
  return listed === "" ? null : JSON.parse(await box.read(NOTE));
}

// ## An interrupted chat wakes once, with the note in its snapshot
void test("An interrupted chat wakes once, with the note in its snapshot", async (t) => {
  const { box, backend, pass } = await setup(t);
  await box.write(NOTE, JSON.stringify(MAINTENANCE));
  const passing = pass();
  await waitForRuns(backend, { count: 1, timeoutMs: 3000 });
  backend.runs[0]?.emitResult();
  await passing;
  t.check({ resumed: backend.runs[0]?.startOptions.resumeSessionId, sent: backend.runs[0]?.sent, note: await notes(box), log: JSON.parse(await box.read(".beebox/chat-wakes.json")) }, {
    resumed: SESSION,
    sent: [[{ type: "text", text: str`<chat-app narration="off" prose="on" local-time="${any(String)}">
<run-ended at="2026-11-02T20:00:00.000Z" cause="box maintenance (deployment)">
Your previous run ended at 2026-11-02T20:00:00.000Z while 1 background task was still running, because box maintenance (deployment). They did not finish; restart any that are still needed.
- collect sources
</run-ended>
</chat-app>
<interrupted-wake at="${any(String)}">The Bee Box started this turn by itself: your previous run was interrupted while background tasks were running (see run-ended). Decide whether to restart the unfinished work, drop it, or ask. Your reply is shown to the person, so say in a line or two what happened and what you are doing.</interrupted-wake>` }]],
    // Delivered, so the note is gone; the wake counts against today's limit.
    note: null,
    log: { [SESSION]: [any(String)] },
  });

  await pass();
  t.check(backend.runs.map((run) => run.startOptions.resumeSessionId), [SESSION]);
});

// ## Endings that are not interruptions, and live runs, do not wake
void test("Endings that are not interruptions, and live runs, do not wake", async (t) => {
  const { box, backend, pass } = await setup(t);
  // A hung run: the work itself stalled.
  await box.write(NOTE, JSON.stringify({ ...MAINTENANCE, cause: "it had produced no output for 4 hours and was treated as hung", wake: false }));
  await pass();
  // A note stamped before `wake` existed, for a requested restart.
  await box.write(NOTE, JSON.stringify({ ...MAINTENANCE, cause: "a restart was requested", wake: undefined }));
  await pass();
  // Unstamped from another server, but the run still holds its chat-active lock: it is live.
  await box.write(NOTE, JSON.stringify({ tasks: ["collect sources"], lastSeenAt: "2026-11-02T20:00:00.000Z", writer: "other-server" }));
  const lock = await acquireChatActiveLock({ boxRoot: box.root, lockId: "live", sessionId: SESSION });
  await pass();
  // Any note while a maintenance owner holds the box.
  await fs.rm(lock, { force: true });
  await box.write(NOTE, JSON.stringify(MAINTENANCE));
  const deploy = await closeBoxMaintenance(box.root, { reason: "deployment" });
  await pass();
  await deploy.release();
  t.check(backend.runs, []);
});

// ## A chat that used its wakes today keeps the note for the person
//
// Two wakes a day per chat, so work that keeps crashing the server cannot loop.
void test("A chat that used its wakes today keeps the note for the person", async (t) => {
  const { box, backend, pass } = await setup(t);
  const now = new Date().toISOString();
  await box.write(".beebox/chat-wakes.json", JSON.stringify({ [SESSION]: [now, now] }));
  await box.write(NOTE, JSON.stringify(MAINTENANCE));
  await pass();
  await pass();
  t.check({ runs: backend.runs, note: await notes(box) }, { runs: [], note: { ...MAINTENANCE, wokenAt: any(String) } });
});

// ## A server crash wakes the chat
//
// An unstamped record another server process wrote, with no live run holding
// the chat-active lock, is a run the server never saw end.
void test("A server crash wakes the chat", async (t) => {
  const { box, backend, pass } = await setup(t);
  await box.write(NOTE, JSON.stringify({ tasks: ["collect sources"], lastSeenAt: "2026-11-02T20:00:00.000Z", writer: "crashed-server" }));
  const passing = pass();
  await waitForRuns(backend, { count: 1, timeoutMs: 3000 });
  backend.runs[0]?.emitResult();
  await passing;
  t.check({ resumed: backend.runs[0]?.startOptions.resumeSessionId, note: await notes(box) }, { resumed: SESSION, note: null });
});
