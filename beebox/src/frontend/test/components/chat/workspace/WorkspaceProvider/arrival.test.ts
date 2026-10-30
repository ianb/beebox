// # Arrival opens the place, and at the root the newest question
//
// Going to a place whose chat has no saved arrangement in this tab opens the
// place beside the chat: its single entry-point card, else its landmark card
// (docs/implemented-plans/landmark-arrival.md, Track D). At the root it also
// opens the newest pending question on top, and on the phone only the
// question (docs/implemented-plans/questions-beside-the-chat.md, Track A). `arrivalPlan`
// makes the final decision in the workspace provider, after the store's
// candidate flag is taken and arrival's queries have settled.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { arrivalPlan, arrivalWaits } from "../../../../../src/components/chat/workspace/WorkspaceProvider/arrival.js";
import { decideWorkspaceNavigation } from "../../../../../src/components/chat/workspace/history.js";

const LIST = "_content/lending/Lending_List.lending-list.card";
const BOX = "_content/Box.landmark.card";
const Q = "_bookkeeping/questions/Pacific-timezone.question.card";

// ## A new place chat on the desktop layout opens the target
//
// The candidate flag is set, nothing is open, and the payload names a target.
void test("The candidate flag is set, nothing is open, and the payload names a target.", async (t) => {
  t.check(arrivalPlan({ arrive: true, viewport: "desktop", tabCount: 0, target: LIST, question: null }), [LIST]);
});

// ## A new root chat opens the Box page, then the question on top
//
// The last path is the active tab, so the question is in front and the Box
// page is under it when the person closes the question.
void test("A new root chat opens the Box page, then the question on top", async (t) => {
  t.check(arrivalPlan({ arrive: true, viewport: "desktop", tabCount: 0, target: BOX, question: Q }), [BOX, Q]);
});

// ## The phone opens only the question
//
// On a phone only one card or the chat fits. The chat wins over the place
// (boxholder decision c); a pending question wins over an empty chat
// (boxholder, 2026-10-25: "the question is mostly what you are responding
// to, not the chat history, so the mobile view works").
void test("The phone opens only the question", async (t) => {
  t.check({
    place: arrivalPlan({ arrive: true, viewport: "mobile", tabCount: 0, target: LIST, question: null }),
    root: arrivalPlan({ arrive: true, viewport: "mobile", tabCount: 0, target: BOX, question: Q }),
  }, { place: [], root: [Q] });
});

// ## A chat with a saved arrangement is left as it was
//
// A saved arrangement clears the candidate flag, so `arrive` is false.
void test("A saved arrangement clears the candidate flag, so arrive is false.", async (t) => {
  t.check(arrivalPlan({ arrive: false, viewport: "desktop", tabCount: 0, target: BOX, question: Q }), []);
});

// ## Arrival never adds to cards that are already open
//
// A chat opened beside Admin has a tab already, so no question opens over it.
void test("Arrival never adds to cards that are already open", async (t) => {
  t.check(arrivalPlan({ arrive: true, viewport: "desktop", tabCount: 1, target: BOX, question: Q }), []);
});

// ## No landmark or a failed query opens what remains
//
// The provider passes null when `forDir` returned no landmark or a query
// failed.
void test("The provider passes null when forDir returned no landmark or the query failed.", async (t) => {
  t.check({
    nothing: arrivalPlan({ arrive: true, viewport: "desktop", tabCount: 0, target: null, question: null }),
    questionOnly: arrivalPlan({ arrive: true, viewport: "desktop", tabCount: 0, target: null, question: Q }),
  }, { nothing: [], questionOnly: [Q] });
});

// ## Only a chat with nothing to open waits for arrival's queries
//
// The provider decides the navigation first and waits for `landmarks.forDir`
// only when that decision is `keep-current`, the one step where arrival can
// apply. A route that names a card is the person's intent: it opens at once,
// even while an arrival is pending and the query is slow or never settles.
void test("The provider decides the navigation first and waits for landmarks.forDir only...", async (t) => {
  const decision = decideWorkspaceNavigation({ history: undefined, scope: "s", identity: "chat-1",
    freshCard: "_content/lending/Piranesi_Noor.loan.card" });
  t.check(
    ({ decision: decision.kind,
      waits: arrivalWaits({ decision: decision.kind, candidate: true, settled: false }) }),
    {
    decision: "open-url",
    waits: false,
  },
  );
});

// A history snapshot is a saved arrangement, so it does not wait either.
void test("A history snapshot is a saved arrangement, so it does not wait either.", async (t) => {
  t.check(arrivalWaits({ decision: "restore-snapshot", candidate: true, settled: false }), false);
});

// A chat with no card in its route waits while the query is in flight, and
// proceeds once it settles.
void test("A chat with no card in its route waits while the query is in flight, and proc...", async (t) => {
  t.check(
    ({ inFlight: arrivalWaits({ decision: "keep-current", candidate: true, settled: false }),
      settled: arrivalWaits({ decision: "keep-current", candidate: true, settled: true }) }),
    {
    inFlight: true,
    settled: false,
  },
  );
});

// A cancelled arrival has no candidate, so it does not wait.
void test("A cancelled arrival has no candidate, so it does not wait.", async (t) => {
  t.check(arrivalWaits({ decision: "keep-current", candidate: false, settled: false }), false);
});
