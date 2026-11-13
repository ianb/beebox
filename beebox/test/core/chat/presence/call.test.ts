// Calls in a chat room (docs/chat-calls.md). One call per room: pressing call
// starts it or joins the one going; members hear every member and the
// transcription state; signals pass only between members of the same call,
// and only from a member that belongs to the caller; people present see the
// call; it ends when nobody answers in time or its last member leaves.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createChatPresence, NO_ANSWER_MS, type CallChange, type CallMemberFrame, type CallSummary, type ChatPresenceFrame } from "../../../../src/core/chat/presence/room.js";

const priya = { email: "priya@example.com", name: "Priya Marlowe" };
const tomas = { email: "tomas@example.com", name: "Tomas Marlowe" };
const odette = { email: "odette@example.com", name: "Odette Marlowe" };
const juni = { email: "juni@example.com", name: "Juniper Marlowe" };
const box = { boxRoot: "/box", sessionId: "chat-0001" };

/** A room with fixed ids and clock, a timer the test fires, and a log of call changes. */
function setup() {
  let id = 0;
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const changes: string[] = [];
  const presence = createChatPresence({
    now: () => 1_000,
    newId: () => `id-${String(++id).padStart(4, "0")}`,
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    onCallChange: (snap, change: CallChange) => {
      changes.push(`${change.kind} ${snap.members.map((m) => m.person.name.split(" ")[0]).join(",")}${snap.transcribing ? " transcribing" : ""}`);
    },
  });
  return { presence, timers, changes };
}

function member() {
  const frames: CallMemberFrame[] = [];
  return { frames, send: (f: CallMemberFrame) => frames.push(f) };
}

function watcher() {
  const calls: (CallSummary | null)[] = [];
  return {
    calls,
    onFrame: (f: ChatPresenceFrame) => {
      if (f.t === "call") calls.push(f.call);
    },
  };
}

void test("starting, answering, and leaving a call", (t) => {
  const { presence, timers, changes } = setup();
  const watching = watcher();
  presence.join({ ...box, person: odette, ...watching });
  const p = member();
  const pj = presence.joinCall({ ...box, callId: null, person: priya, send: p.send });
  t.check(pj.ok ? [pj.callId, pj.peerId] : null, ["id-0001", "id-0002"]);
  // Tomas presses call too: a null call id joins the call already going.
  const tm = member();
  const tj = presence.joinCall({ ...box, callId: null, person: tomas, send: tm.send });
  const priyaPeer = { peerId: "id-0002", person: priya };
  const tomasPeer = { peerId: "id-0003", person: tomas };
  t.check(p.frames, [
    { t: "joined", callId: "id-0001", peerId: "id-0002", serverNowMs: 1_000 },
    { t: "state", members: [priyaPeer], transcribing: false },
    { t: "state", members: [priyaPeer, tomasPeer], transcribing: false },
  ]);
  t.check(tm.frames, [
    { t: "joined", callId: "id-0001", peerId: "id-0003", serverNowMs: 1_000 },
    { t: "state", members: [priyaPeer, tomasPeer], transcribing: false },
  ]);
  // Someone answered, so the no-answer timer is cancelled.
  t.check(timers.map((x) => [x.ms, x.cancelled]), [[NO_ANSWER_MS, true]]);
  if (tj.ok) tj.leave();
  if (pj.ok) pj.leave();
  // Odette, present but not on the call, saw it start, grow, shrink, and end.
  t.check(watching.calls, [
    null,
    { callId: "id-0001", members: [priya], transcribing: false, startedAt: 1_000 },
    { callId: "id-0001", members: [priya, tomas], transcribing: false, startedAt: 1_000 },
    { callId: "id-0001", members: [priya], transcribing: false, startedAt: 1_000 },
    null,
  ]);
  t.check(changes, ["started Priya", "members Priya,Tomas", "members Priya", "ended "]);
  t.end();
});

void test("a call nobody answers ends, telling its starter why", (t) => {
  const { presence, timers } = setup();
  const p = member();
  presence.joinCall({ ...box, callId: null, person: priya, send: p.send });
  // A second tab of the caller is not an answer.
  presence.joinCall({ ...box, callId: null, person: priya, send: () => 0 });
  timers[0]?.fn();
  t.check(p.frames.at(-1), { t: "ended", reason: "no-answer" });
  t.check(presence.size(), 0);
  // Joining the ended call by id finds nothing.
  t.check(presence.joinCall({ ...box, callId: "id-0001", person: tomas, send: () => 0 }), { ok: false, reason: "no-call" });
  t.end();
});

void test("a call holds three members; a fourth is turned away", (t) => {
  const { presence } = setup();
  for (const person of [priya, tomas, odette]) presence.joinCall({ ...box, callId: null, person, send: () => 0 });
  t.check(presence.joinCall({ ...box, callId: null, person: juni, send: () => 0 }), { ok: false, reason: "full" });
  t.end();
});

void test("signals pass only from the caller's own member to another member of the call", (t) => {
  const { presence } = setup();
  const p = member();
  const tm = member();
  presence.joinCall({ ...box, callId: null, person: priya, send: p.send });
  presence.joinCall({ ...box, callId: null, person: tomas, send: tm.send });
  const fromPriya = { ...box, callId: "id-0001", peerId: "id-0002", email: "priya@example.com" };
  t.check(
    [
      presence.signal(fromPriya, { to: "id-0003", data: { sdp: "offer" } }),
      // Tomas cannot speak as Priya's peer.
      presence.signal({ ...fromPriya, email: "tomas@example.com" }, { to: "id-0003", data: "forged" }),
      // Nor to a peer that is not on the call, nor to itself.
      presence.signal(fromPriya, { to: "id-9999", data: "lost" }),
      presence.signal(fromPriya, { to: "id-0002", data: "echo" }),
    ],
    [true, false, false, false],
  );
  t.check(tm.frames.filter((f) => f.t === "signal"), [{ t: "signal", from: "id-0002", data: { sdp: "offer" } }]);
  t.end();
});

void test("any member turns transcription on for everyone; others cannot", (t) => {
  const { presence, changes } = setup();
  const watching = watcher();
  presence.join({ ...box, person: odette, ...watching });
  const p = member();
  presence.joinCall({ ...box, callId: null, person: priya, send: p.send });
  presence.joinCall({ ...box, callId: null, person: tomas, send: () => 0 });
  const tomasRef = { ...box, callId: "id-0001", peerId: "id-0003", email: "tomas@example.com" };
  t.check([presence.setTranscribing({ ...tomasRef, email: "odette@example.com" }, true), presence.setTranscribing(tomasRef, true)], [false, true]);
  t.check(p.frames.at(-1), {
    t: "state",
    members: [{ peerId: "id-0002", person: priya }, { peerId: "id-0003", person: tomas }],
    transcribing: true,
  });
  t.check(watching.calls.at(-1), { callId: "id-0001", members: [priya, tomas], transcribing: true, startedAt: 1_000 });
  t.check(changes.at(-1), "transcribing Priya,Tomas transcribing");
  t.end();
});

void test("leaving by mutation needs the caller's own member", (t) => {
  const { presence } = setup();
  presence.joinCall({ ...box, callId: null, person: priya, send: () => 0 });
  const ref = { ...box, callId: "id-0001", peerId: "id-0002", email: "priya@example.com" };
  t.check([presence.leaveCall({ ...ref, email: "tomas@example.com" }), presence.leaveCall(ref), presence.leaveCall(ref)], [false, true, false]);
  t.check(presence.size(), 0);
  t.end();
});
