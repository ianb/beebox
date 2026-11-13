// # This tab's call, as the call bar sees it
//
// `callReducer` folds the server's call frames and the browser's media and
// connection reports into one state; `callOffer` and `callBarView` decide
// what the phone button and the call bar show (docs/plans/chat-calls.md,
// Tracks C and D).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { callBarView, callOffer, callReducer, clockOffset, IDLE, type CallEvent, type CallUiState } from "../../src/lib/call-state.js";

const priya = { email: "priya@example.com", name: "Priya Okafor" };
const tomas = { email: "tomas@example.com", name: "Tomas Marlowe" };

function run(events: CallEvent[]): CallUiState {
  return events.reduce(callReducer, IDLE);
}

const start: CallEvent = { type: "start", sessionId: "s1", mic: "on", relay: false, clockOffsetMs: 500 };
const joined: CallEvent = { type: "frame", frame: { t: "joined", callId: "call-1", peerId: "peer-b", serverNowMs: 10_000 } };
const both: CallEvent = {
  type: "frame",
  frame: { t: "state", transcribing: true, members: [{ peerId: "peer-a", person: tomas }, { peerId: "peer-b", person: priya }] },
};

void test("joining records the peer id and the clock offset; a second member ends the ringing", (t) => {
  t.check(run([start, joined, both]), {
    phase: "in-call", sessionId: "s1", callId: "call-1", selfPeerId: "peer-b", clockOffsetMs: 500,
    members: [{ peerId: "peer-a", person: tomas }, { peerId: "peer-b", person: priya }],
    everJoined: true, links: {}, mic: "on", camera: "off", transcribing: true, recording: { state: "off" }, relay: false,
  });
  t.end();
});

// The cause names a missing relay only when the ICE servers had none.
void test("a failed connection names its cause; a member who leaves drops its link", (t) => {
  const failed = run([start, joined, both, { type: "link", peerId: "peer-a", report: "failed" }]);
  t.check(failed.phase === "in-call" ? failed.links : null, { "peer-a": { state: "failed", cause: "no-relay" } });
  const withRelay = run([{ ...start, relay: true }, joined, both, { type: "link", peerId: "peer-a", report: "failed" }]);
  t.check(withRelay.phase === "in-call" ? withRelay.links : null, { "peer-a": { state: "failed", cause: "failed" } });
  const left = callReducer(failed, { type: "frame", frame: { t: "state", transcribing: false, members: [{ peerId: "peer-b", person: priya }] } });
  t.check(left.phase === "in-call" ? [left.links, left.everJoined] : null, [{}, true]);
  t.end();
});

void test("how a call ends: no answer, full, or gone before this tab got in", (t) => {
  t.check(run([start, joined, { type: "frame", frame: { t: "ended", reason: "no-answer" } }]), { phase: "ended", sessionId: "s1", reason: "no-answer" });
  t.check(run([start, { type: "frame", frame: { t: "full" } }]), { phase: "ended", sessionId: "s1", reason: "full" });
  t.check(run([start, { type: "frame", frame: { t: "ended", reason: "no-answer" } }]), { phase: "ended", sessionId: "s1", reason: "gone" });
  t.check(run([start, joined, { type: "lost" }, { type: "leave" }]), { phase: "idle" });
  t.end();
});

const going = { sessionId: "s1", call: { callId: "call-1", members: [tomas], transcribing: false, startedAt: 0 } };

void test("the phone button: start with someone here, join a call I am not on, nothing otherwise", (t) => {
  t.check(callOffer({ others: 1, presence: { sessionId: "s1", call: null }, ui: IDLE, selfEmail: priya.email }), "start");
  t.check(callOffer({ others: 0, presence: { sessionId: "s1", call: null }, ui: IDLE, selfEmail: priya.email }), null);
  t.check(callOffer({ others: 1, presence: going, ui: IDLE, selfEmail: priya.email }), "join");
  t.check(callOffer({ others: 1, presence: going, ui: IDLE, selfEmail: tomas.email }), null);
  t.check(callOffer({ others: 1, presence: going, ui: run([start]), selfEmail: priya.email }), null);
  t.end();
});

void test("the call bar for someone not on the call", (t) => {
  t.check(callBarView({ ui: IDLE, presence: going, sessionId: "s1", selfEmail: priya.email }), {
    kind: "ringing", callId: "call-1", people: ["Tomas Marlowe"], transcribing: false, full: false,
  });
  // A tab whose person is already on the call (another tab) is not offered Join.
  t.check(callBarView({ ui: IDLE, presence: going, sessionId: "s1", selfEmail: tomas.email }), { kind: "other-tab", transcribing: false });
  t.check(callBarView({ ui: IDLE, presence: going, sessionId: "other-chat", selfEmail: priya.email }), { kind: "none" });
  t.end();
});

void test("the clock offset is taken at the round trip's midpoint, so network delay is not skew", (t) => {
  // Clocks agree; the server answered 600 ms into a 1.2 s round trip.
  t.check(clockOffset({ sentAtMs: 10_000, receivedAtMs: 11_200, serverNowMs: 10_600 }), 0);
  // This device runs 3 s ahead.
  t.check(clockOffset({ sentAtMs: 13_000, receivedAtMs: 13_100, serverNowMs: 10_050 }), 3_000);
  t.end();
});
