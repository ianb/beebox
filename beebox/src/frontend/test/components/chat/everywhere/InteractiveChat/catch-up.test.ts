// # Catching up after a long hide
//
// Back on a chat after the page was hidden a while, the transcript can be out
// of date until history reloads. The chat refreshes at once and says
// "Catching up…" until fresh data lands
// (issues/bugs/2026-11-01-chat-return-shows-old-transcript-with-no-loading-sign.md).
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../../../helpers/dom-harness.js";
import { createElement as h, type ReactNode } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  advanceCatchUp,
  CATCH_UP_MIN_HIDDEN_MS,
  CATCH_UP_SHOW_DELAY_MS,
  initialCatchUpState,
  useCatchUp,
  type CatchUpInput,
  type CatchUpState,
} from "../../../../../src/components/chat/everywhere/InteractiveChat/catch-up.js";
import type { ChatMachineDisplayPhase } from "../../../../../src/components/chat/everywhere/InteractiveChat/processing-status-display.js";
import type { ChatEvent } from "../../../../../src/machines/chat-types.js";

function run(inputs: CatchUpInput[]): { active: boolean[]; refresh: boolean[] } {
  let state: CatchUpState = initialCatchUpState;
  const active: boolean[] = [];
  const refresh: boolean[] = [];
  for (const input of inputs) {
    const step = advanceCatchUp(state, input);
    state = step.state;
    active.push(state.active);
    refresh.push(step.refresh);
  }
  return { active, refresh };
}

const LONG = CATCH_UP_MIN_HIDDEN_MS;

// ## An idle chat refreshes on return and catches up when the fetch lands
void test("An idle chat refreshes on return and catches up when the fetch lands", async (t) => {
  t.check(run([
    { type: "hidden", at: 0 },
    { type: "visible", at: LONG, phase: "idle", progress: 0, tracked: true },
    { type: "observe", phase: "idle", progress: 0 },
    { type: "observe", phase: "refreshing-resync", progress: 0 },
    { type: "observe", phase: "idle", progress: 0 },
  ]), {
    active: [false, true, true, true, false],
    refresh: [false, true, false, false, false],
  });
});

// ## A brief hide changes nothing
void test("A brief hide changes nothing", async (t) => {
  t.check(run([
    { type: "hidden", at: 0 },
    { type: "visible", at: LONG - 1, phase: "idle", progress: 0, tracked: true },
  ]), { active: [false, false], refresh: [false, false] });
});

// ## A chat with no session yet has no history to fall behind on
void test("A chat with no session yet has no history to fall behind on", async (t) => {
  t.check(run([
    { type: "hidden", at: 0 },
    { type: "visible", at: LONG, phase: "idle", progress: 0, tracked: false },
  ]), { active: [false, false], refresh: [false, false] });
});

// ## A streaming chat waits for the stream, without a REFRESH it would ignore
void test("A streaming chat waits for the stream, without a REFRESH it would ignore", async (t) => {
  t.check(run([
    { type: "hidden", at: 0 },
    { type: "visible", at: LONG, phase: "streaming", progress: 12, tracked: true },
    { type: "observe", phase: "streaming", progress: 12 },
    { type: "observe", phase: "streaming", progress: 40 },
  ]), { active: [false, true, true, false], refresh: [false, false, false, false] });

  // The stream was lost while hidden: the recovery refresh lands instead.
  t.check(run([
    { type: "hidden", at: 0 },
    { type: "visible", at: LONG, phase: "streaming", progress: 12, tracked: true },
    { type: "observe", phase: "refreshing-turn", progress: 12 },
    { type: "observe", phase: "idle", progress: 0 },
  ]).active, [false, true, true, false]);
});

// ## A fetch already running at the return counts
void test("A fetch already running at the return counts", async (t) => {
  t.check(run([
    { type: "hidden", at: 0 },
    { type: "visible", at: LONG, phase: "refreshing-resync", progress: 0, tracked: true },
    { type: "observe", phase: "idle", progress: 0 },
  ]), { active: [false, true, false], refresh: [false, false, false] });
});

// ## Expiry ends it whatever happened
void test("Expiry ends it whatever happened", async (t) => {
  t.check(run([
    { type: "hidden", at: 0 },
    { type: "visible", at: LONG, phase: "streaming", progress: 0, tracked: true },
    { type: "expire" },
  ]).active, [false, true, false]);
});

// ## In the page: the label waits for the show delay and clears on the fetch
void test("In the page: the label waits for the show delay and clears on the fetch", async (t) => {
  let now = 1_000_000;
  const realNow = Date.now;
  Date.now = () => now;
  t.teardown(() => { Date.now = realNow; });
  const setVisibility = (value: "hidden" | "visible") => {
    Object.defineProperty(document, "visibilityState", { value, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  const sent: string[] = [];
  const send = (event: ChatEvent): void => { sent.push(event.type); };
  const seen: boolean[] = [];
  function Host({ phase }: { phase: ChatMachineDisplayPhase }): ReactNode {
    seen.push(useCatchUp({ phase, progress: 0, tracked: true, send }));
    return null;
  }
  const view = await mount(h(Host, { phase: "idle" }));
  t.teardown(() => view.unmount());

  await view.act(() => { setVisibility("hidden"); });
  now += LONG;
  await view.act(() => { setVisibility("visible"); });
  await view.rerender(h(Host, { phase: "refreshing-resync" }));
  const beforeDelay = seen.at(-1);
  // A timer set after the show timer, with a later deadline, fires after it:
  // Node runs timers in deadline order. Waiting inside act flushes the update.
  await view.act(() => new Promise((resolve) => { setTimeout(resolve, CATCH_UP_SHOW_DELAY_MS + 10); }));
  const afterDelay = seen.at(-1);
  await view.rerender(h(Host, { phase: "idle" }));
  t.check({ sent, beforeDelay, afterDelay, landed: seen.at(-1) }, {
    sent: ["REFRESH"],
    beforeDelay: false,
    afterDelay: true,
    landed: false,
  });
});
