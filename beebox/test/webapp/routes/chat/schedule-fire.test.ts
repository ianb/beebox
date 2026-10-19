// # Firing a chat schedule into its originating session
//
// `fireChatSchedule` (`src/webapp/routes/chat/schedule-fire.ts`) injects a fired
// check-in back into the session that created it — not whatever chat was last
// active. A check-in belongs to one conversation (boxholder, 2026-10-18: if the
// conversation ends, the check-in ends), so it never moves to another one: a
// legacy entry with no session, a session that cannot be resumed, and a turn
// that errors all drop the fire, and a dropped fire sends no alarm.
//
// The fake `ChatBackend` records each spawned run's `startOptions.resumeSessionId`,
// so a run's resume id is how we assert which session a fire landed in. The
// failed-turn signal is the session's `done` event carrying an `is_error` result;
// the fake scripts it via `emitResult({ isError: true })`.

import { test } from "tap";
import "agent-doctest/tap";
import { fireChatSchedule } from "../../../../src/webapp/routes/chat/schedule-fire.js";
import { ChatSessionRegistry } from "../../../../src/core/chat/session/registry/core.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { createEventBus } from "../../../../src/core/event-bus/core.js";
import { setMostActive } from "../../../../src/core/chat/session/history.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { waitForRuns, plainTestPrompt } from "../../../helpers/chat-session-spawner-helpers.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";
const SESSION_MOST_ACTIVE = "33333333-3333-4333-8333-333333333333";
const SESSION_DEAD = "44444444-4444-4444-8444-444444444444";

function makeRegistry(boxRoot: string, backend: ReturnType<typeof createFakeChatBackend>) {
  return new ChatSessionRegistry(boxRoot, {
    backend,
    buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }),
  });
}

const noopWire = (_s: unknown): void => {};

async function makeTranscript(boxRoot: string, sessionId: string): Promise<void> {
  const logPath = getSessionLogPath(boxRoot, sessionId);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, "{}\n");
}

function makeSchedule(opts: { sessionId?: string }) {
  return {
    id: "sch_test",
    label: "reminder",
    alarm: false,
    announce: null,
    content: "check the thing",
    createdAt: "2026-01-01T00:00:00.000Z",
    firesAt: "2026-01-01T00:00:00.000Z",
    ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
  };
}

// ## Fires into the originating session, even when another is most-active
//
// Session `B` is most-active, but the schedule was created in session `A`. The
// fire resumes `A`, not `B`.
void test("Session B is most-active, but the schedule was created in session A.", async (t) => {
  t.teardown(async () => {
    try {
      registry.shutdown();
      eventBus.close();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L67
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const registry = makeRegistry(box.root, backend);
  const eventBus = createEventBus(box.root);
  await setMostActive(box.root, SESSION_B);
  await makeTranscript(box.root, SESSION_A);

  // doctest:L74
  const firePromise = fireChatSchedule(
    { boxRoot: box.root, registry, eventBus, wireSession: noopWire },
    makeSchedule({ sessionId: SESSION_A }),
  );
  await waitForRuns(backend, { count: 1, timeoutMs: 2000 });
  backend.runs[0]?.emitResult();
  await firePromise;

  // doctest:L82
  t.check({ runs: backend.runs.length, resumed: backend.runs[0]?.startOptions.resumeSessionId }, {
    runs: 1,
    resumed: "11111111-1111-4111-8111-111111111111",
  });

  // The reminder is composed by beebox, not typed, so it goes out marked
  // client-composed.

  // doctest:L90
  t.check(backend.runs[0]?.sentClientComposed, [
    true,
  ]);
});

// ## A check-in goes nowhere but its own conversation
//
// A legacy entry (no `sessionId`) is not sent to the most-active chat; a chat
// with no transcript to resume (deleted, archived, never written) is not
// replaced by a fresh one. Neither starts a run, and neither broadcasts the
// alarm, because the target is checked first.
void test("A legacy entry and an unresumable chat both drop the fire silently", async (t) => {
  const box2 = await makeTmpBox({ git: true });
  const backend2 = createFakeChatBackend();
  const registry2 = makeRegistry(box2.root, backend2);
  const eventBus2 = createEventBus(box2.root);
  t.teardown(() => { registry2.shutdown(); eventBus2.close(); });
  await setMostActive(box2.root, SESSION_MOST_ACTIVE);
  await makeTranscript(box2.root, SESSION_MOST_ACTIVE);
  const deps = { boxRoot: box2.root, registry: registry2, eventBus: eventBus2, wireSession: noopWire };

  await fireChatSchedule(deps, makeSchedule({}));
  await fireChatSchedule(deps, makeSchedule({ sessionId: SESSION_DEAD }));
  const fired = eventBus2.readSince(0).filter((event) => event.event === "schedule-fired");
  t.check({ runs: backend2.runs, fired }, { runs: [], fired: [] });
});

// ## A failed turn is not retried in a fresh session
//
// When the targeted session's turn ends with `is_error`, the check-in is
// dropped: a second run in a new chat would be a conversation the person never
// had.
void test("A check-in whose turn errors is not re-sent into a fresh session", async (t) => {
  const box3 = await makeTmpBox({ git: true });
  const backend3 = createFakeChatBackend();
  const registry3 = makeRegistry(box3.root, backend3);
  const eventBus3 = createEventBus(box3.root);
  t.teardown(() => { registry3.shutdown(); eventBus3.close(); });
  await makeTranscript(box3.root, SESSION_DEAD);

  const firePromise3 = fireChatSchedule(
    { boxRoot: box3.root, registry: registry3, eventBus: eventBus3, wireSession: noopWire },
    makeSchedule({ sessionId: SESSION_DEAD }),
  );
  await waitForRuns(backend3, { count: 1, timeoutMs: 2000 });
  backend3.runs[0]?.emitResult({ isError: true });
  await firePromise3;
  t.check(backend3.runs.map((run) => run.startOptions.resumeSessionId ?? null), [SESSION_DEAD]);
});

// ## A chat whose model was removed drops the schedule
//
// A chat that explicitly picked an OpenRouter model the owner has since removed
// refuses its turn. The fired schedule goes nowhere — no fresh-session retry on
// the box default. Scheduled messages are low priority, and a retry would change
// which model answers (boxholder, 2026-09-19).
void test("A chat that explicitly picked an OpenRouter model the owner has since removed...", async (t) => {
  t.teardown(async () => {
    try {
      registry4.shutdown();
      eventBus4.close();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L175
  const box4 = await makeTmpBox({ git: true });
  const backend4 = createFakeChatBackend();
  const registry4 = makeRegistry(box4.root, backend4);
  const eventBus4 = createEventBus(box4.root);
  await makeTranscript(box4.root, SESSION_A);
  // The chat's own pick; the box config has no openrouterModels, as after removal.
  registry4.getOrCreate(SESSION_A).setModel("moonshotai/kimi-k2-0905:exacto");

  // doctest:L183
  await fireChatSchedule(
    { boxRoot: box4.root, registry: registry4, eventBus: eventBus4, wireSession: noopWire },
    makeSchedule({ sessionId: SESSION_A }),
  );
  await t.checkText(backend4.runs.length, "0");
});
