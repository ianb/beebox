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
  // doctest:L20
  t.check(isLegalChatPhaseTransition("idle", "starting"), true);

  // doctest:L23
  t.check(isLegalChatPhaseTransition("starting", "ready"), true);

  // doctest:L26
  t.check(isLegalChatPhaseTransition("ready", "streaming"), true);

  // doctest:L29
  t.check(isLegalChatPhaseTransition("streaming", "ready"), true);

  // doctest:L32
  t.check(isLegalChatPhaseTransition("streaming", "stopping"), true);

  // doctest:L35
  t.check(isLegalChatPhaseTransition("stopping", "idle"), true);

  // doctest:L38
  t.check(isLegalChatPhaseTransition("streaming", "idle"), true);
});

// ## Illegal transitions are rejected
//
// You can't stream without starting, resurrect a stopped run, or skip phases.
void test("You can't stream without starting, resurrect a stopped run, or skip phases.", async (t) => {
  // doctest:L47
  t.check(isLegalChatPhaseTransition("idle", "streaming"), false);

  // doctest:L50
  t.check(isLegalChatPhaseTransition("stopping", "streaming"), false);

  // doctest:L53
  t.check(isLegalChatPhaseTransition("ready", "starting"), false);

  // doctest:L56
  t.check(isLegalChatPhaseTransition("idle", "idle"), false);
});

// ## `busy` and `run` readings match the phase
//
// `idle` and `ready` accept a new send; `starting` and `streaming` are busy (queue
// the send), as is a `stopping` that interrupted a turn. Only the run-carrying
// phases expose a handle.
void test("idle and ready accept a new send; starting and streaming are busy (queue the...", async (t) => {
  // doctest:L67
  t.check(lifecycleBusy(IDLE), false);

  // doctest:L70
  t.check(lifecycleBusy({ phase: "starting" }), true);

  // doctest:L73
  t.check(lifecycleBusy({ phase: "streaming", run }), true);

  // doctest:L76
  t.check(lifecycleBusy({ phase: "stopping", run, wasBusy: true }), true);

  // doctest:L79
  t.check(lifecycleBusy({ phase: "stopping", run, wasBusy: false }), false);

  // doctest:L82
  t.check(lifecycleRun(IDLE), null);

  // doctest:L85
  t.check(lifecycleRun({ phase: "starting" }), null);
});
