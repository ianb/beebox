// # Catching up after a long hide
//
// Back on a chat after the page was hidden a while, the transcript can be out
// of date until history reloads. The chat refreshes at once and says
// "Catching up…" until history lands or the live stream delivers
// (issues/bugs/2026-11-01-chat-return-shows-old-transcript-with-no-loading-sign.md).
// "History lands" is the machine's `historySyncs` changing: it counts only
// successful loads, so a failed fetch does not end the label.
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
  type CatchUpChat,
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

function chat(phase: ChatMachineDisplayPhase, more?: Partial<CatchUpChat>): CatchUpChat {
  return { phase, progress: 0, syncs: 1, tracked: true, ...more };
}

const LONG = CATCH_UP_MIN_HIDDEN_MS;
const back = (c: CatchUpChat): CatchUpInput[] => [{ type: "hidden", at: 0 }, { type: "visible", at: LONG, chat: c }];

// ## An idle chat refreshes on return and catches up when history lands
void test("An idle chat refreshes on return and catches up when history lands", async (t) => {
  t.check(run([
    ...back(chat("idle")),
    { type: "observe", chat: chat("refreshing-resync") },
    { type: "observe", chat: chat("idle", { syncs: 2 }) },
  ]), {
    active: [false, true, true, false],
    refresh: [false, true, false, false],
  });
});

// ## A failed fetch keeps the label; a later refresh that lands ends it
void test("A failed fetch keeps the label; a later refresh that lands ends it", async (t) => {
  t.check(run([
    ...back(chat("idle")),
    { type: "observe", chat: chat("refreshing-resync") },
    { type: "observe", chat: chat("idle") },
    { type: "observe", chat: chat("refreshing-resync") },
    { type: "observe", chat: chat("idle", { syncs: 2 }) },
  ]).active, [false, true, true, true, true, false]);
});

// ## A brief hide, or a chat with no session yet, changes nothing
void test("A brief hide, or a chat with no session yet, changes nothing", async (t) => {
  t.check(run([
    { type: "hidden", at: 0 },
    { type: "visible", at: LONG - 1, chat: chat("idle") },
  ]), { active: [false, false], refresh: [false, false] });
  t.check(run(back(chat("idle", { tracked: false }))), { active: [false, false], refresh: [false, false] });
});

// ## A streaming chat waits for the stream, without a REFRESH it would ignore
void test("A streaming chat waits for the stream, without a REFRESH it would ignore", async (t) => {
  t.check(run([
    ...back(chat("streaming", { progress: 12 })),
    { type: "observe", chat: chat("streaming", { progress: 12 }) },
    { type: "observe", chat: chat("streaming", { progress: 40 }) },
  ]), { active: [false, true, true, false], refresh: [false, false, false, false] });

  // The stream was lost while hidden: the recovery refresh lands instead.
  t.check(run([
    ...back(chat("streaming", { progress: 12 })),
    { type: "observe", chat: chat("refreshing-turn", { progress: 12 }) },
    { type: "observe", chat: chat("idle", { syncs: 2 }) },
  ]).active, [false, true, true, false]);
});

// ## The time cap waits out a fetch in flight
void test("The time cap waits out a fetch in flight", async (t) => {
  t.check(run([
    ...back(chat("streaming")),
    { type: "expire", chat: chat("refreshing-turn") },
    { type: "observe", chat: chat("idle") },
  ]).active, [false, true, true, false]);
  t.check(run([
    ...back(chat("streaming")),
    { type: "expire", chat: chat("streaming") },
  ]).active, [false, true, false]);
});

// ## In the page: the label waits for the show delay and clears when history lands
void test("In the page: the label waits for the show delay and clears when history lands", async (t) => {
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
  function Host({ phase, syncs }: { phase: ChatMachineDisplayPhase; syncs: number }): ReactNode {
    seen.push(useCatchUp({ phase, progress: 0, syncs, tracked: true, send }));
    return null;
  }
  const view = await mount(h(Host, { phase: "idle", syncs: 1 }));
  t.teardown(() => view.unmount());

  await view.act(() => { setVisibility("hidden"); });
  now += LONG;
  await view.act(() => { setVisibility("visible"); });
  await view.rerender(h(Host, { phase: "refreshing-resync", syncs: 1 }));
  const beforeDelay = seen.at(-1);
  // A timer set after the show timer, with a later deadline, fires after it:
  // Node runs timers in deadline order. Waiting inside act flushes the update.
  await view.act(() => new Promise((resolve) => { setTimeout(resolve, CATCH_UP_SHOW_DELAY_MS + 10); }));
  const afterDelay = seen.at(-1);
  await view.rerender(h(Host, { phase: "idle", syncs: 2 }));
  t.check({ sent, beforeDelay, afterDelay, landed: seen.at(-1) }, {
    sent: ["REFRESH"],
    beforeDelay: false,
    afterDelay: true,
    landed: false,
  });
});
