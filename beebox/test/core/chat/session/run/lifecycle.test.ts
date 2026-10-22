// # Chat run lifecycle
//
// `run/lifecycle.ts` models the chat-run phases as a discriminated
// union and centralises the legal transitions. The pure predicates are the seam:
// they need no SDK run, so the phase graph is fully exercised here.
// `ChatSession` asserts against `isLegalChatPhaseTransition` at its write sites.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  isLegalChatPhaseTransition,
  lifecycleBusy,
  lifecycleRun,
  IDLE,
} from "../../../../../src/core/chat/session/run/lifecycle.js";
import { createFakeChatBackend } from "../../../../../src/services/claude-chat/core.js";

// A real run handle from the fake backend; the predicates under test only read its presence.
const run = createFakeChatBackend().start({ cwd: ".", systemPrompt: "", env: {} });

// ## Legal transitions — the run's happy path and teardown
void test("Legal transitions — the run's happy path and teardown", async (t) => {
  t.check(isLegalChatPhaseTransition("idle", "starting"), true);

  t.check(isLegalChatPhaseTransition("starting", "ready"), true);

  t.check(isLegalChatPhaseTransition("ready", "streaming"), true);

  t.check(isLegalChatPhaseTransition("streaming", "ready"), true);

  t.check(isLegalChatPhaseTransition("streaming", "stopping"), true);

  t.check(isLegalChatPhaseTransition("stopping", "idle"), true);

  t.check(isLegalChatPhaseTransition("streaming", "idle"), true);
});

// ## Illegal transitions are rejected
//
// You can't stream without starting, resurrect a stopped run, or skip phases.
void test("You can't stream without starting, resurrect a stopped run, or skip phases.", async (t) => {
  t.check(isLegalChatPhaseTransition("idle", "streaming"), false);

  t.check(isLegalChatPhaseTransition("stopping", "streaming"), false);

  t.check(isLegalChatPhaseTransition("ready", "starting"), false);

  t.check(isLegalChatPhaseTransition("idle", "idle"), false);
});

// ## `busy` and `run` readings match the phase
//
// `idle` and `ready` accept a new send; `starting` and `streaming` are busy (queue
// the send), as is a `stopping` that interrupted a turn. Only the run-carrying
// phases expose a handle.
void test("idle and ready accept a new send; starting and streaming are busy (queue the...", async (t) => {
  t.check(lifecycleBusy(IDLE), false);

  t.check(lifecycleBusy({ phase: "starting" }), true);

  t.check(lifecycleBusy({ phase: "streaming", run }), true);

  t.check(lifecycleBusy({ phase: "stopping", run, wasBusy: true }), true);

  t.check(lifecycleBusy({ phase: "stopping", run, wasBusy: false }), false);

  t.check(lifecycleRun(IDLE), null);

  t.check(lifecycleRun({ phase: "starting" }), null);
});
