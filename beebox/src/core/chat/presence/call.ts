/**
 * The call in one chat room: who is on it, transcription, and the no-answer
 * timer. `room.ts` owns the rooms and calls these with a {@link Place}.
 * See docs/chat-calls.md.
 */

import {
  CALL_MEMBER_CAP,
  NO_ANSWER_MS,
  type CallChange,
  type CallEndReason,
  type CallJoinResult,
  type CallMemberFrame,
  type CallPeer,
  type CallSnapshot,
  type CallSummary,
  type PresentPerson,
} from "./types.js";
import { othersFor, type Watcher } from "./others.js";

export interface LiveMember extends CallPeer, Watcher {
  send: (frame: CallMemberFrame) => void;
}

export interface Call {
  callId: string;
  startedAt: number;
  startedBy: PresentPerson;
  transcribing: boolean;
  members: Map<string, LiveMember>;
  /** Whether a second person ever joined; until then the no-answer timer runs. */
  answered: boolean;
  cancelNoAnswer: (() => void) | null;
}

/** What call code needs from the room that holds it. */
export interface Place {
  boxRoot: string;
  sessionId: string;
  getCall: () => Call | null;
  setCall: (call: Call | null) => void;
  /** Tell the room's watchers the call changed, and drop the room if it is now empty. */
  roomChanged: () => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => () => void;
  newId: () => string;
  nextSeq: () => number;
  onCallChange: ((snapshot: CallSnapshot, change: CallChange) => void) | undefined;
}

export function warnOnThrow(what: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    // One subscriber failing must not keep the others from hearing the change.
    console.warn(`[chat-presence] ${what} failed:`, e);
  }
}

/** The call as people present see it: one entry per person, earliest first. */
export function callSummary(call: Call | null): CallSummary | null {
  if (call === null) return null;
  return { callId: call.callId, members: othersFor([...call.members.values()], ""), transcribing: call.transcribing, startedAt: call.startedAt };
}

function peersOf(call: Call): CallPeer[] {
  return [...call.members.values()].toSorted((a, b) => a.seq - b.seq).map(({ peerId, person }) => ({ peerId, person }));
}

function tell(place: Place, { call, change }: { call: Call; change: CallChange }): void {
  const observer = place.onCallChange;
  if (observer === undefined) return;
  const snapshot: CallSnapshot = {
    boxRoot: place.boxRoot,
    sessionId: place.sessionId,
    callId: call.callId,
    startedAt: call.startedAt,
    startedBy: call.startedBy,
    members: peersOf(call),
    transcribing: call.transcribing,
  };
  warnOnThrow("the call observer", () => observer(snapshot, change));
}

function sendAll(call: Call, frame: CallMemberFrame): void {
  for (const m of call.members.values()) warnOnThrow("a call member's update", () => m.send(frame));
}

function sendState(call: Call): void {
  sendAll(call, { t: "state", members: peersOf(call), transcribing: call.transcribing });
}

/** End the call, telling any members still on it why. */
function endCall(place: Place, reason: CallEndReason | null): void {
  const call = place.getCall();
  if (call === null) return;
  call.cancelNoAnswer?.();
  place.setCall(null);
  if (reason !== null) sendAll(call, { t: "ended", reason });
  call.members.clear();
  tell(place, { call, change: { kind: "ended" } });
  place.roomChanged();
}

function startCall(place: Place, person: PresentPerson): Call {
  const call: Call = {
    callId: place.newId(),
    startedAt: place.now(),
    startedBy: person,
    transcribing: false,
    members: new Map(),
    answered: false,
    cancelNoAnswer: null,
  };
  place.setCall(call);
  call.cancelNoAnswer = place.setTimer(() => {
    if (place.getCall() === call && !call.answered) endCall(place, "no-answer");
  }, NO_ANSWER_MS);
  return call;
}

/** The room's call, started when there is none and `callId` is null. */
function callToJoin(place: Place, opts: { callId: string | null; person: PresentPerson }): { call: Call; started: boolean } | null {
  const existing = place.getCall();
  if (existing === null) return opts.callId === null ? { call: startCall(place, opts.person), started: true } : null;
  if (opts.callId !== null && opts.callId !== existing.callId) return null;
  return { call: existing, started: false };
}

export function joinCall(place: Place, opts: { callId: string | null; person: PresentPerson; send: (frame: CallMemberFrame) => void }): CallJoinResult {
  const found = callToJoin(place, opts);
  if (found === null) {
    place.roomChanged();
    return { ok: false, reason: "no-call" };
  }
  const { call, started } = found;
  if (call.members.size >= CALL_MEMBER_CAP) return { ok: false, reason: "full" };
  const peerId = place.newId();
  call.members.set(peerId, { peerId, person: opts.person, seq: place.nextSeq(), send: opts.send });
  if (!call.answered && othersFor([...call.members.values()], call.startedBy.email).length > 0) {
    call.answered = true;
    call.cancelNoAnswer?.();
    call.cancelNoAnswer = null;
  }
  warnOnThrow("a call member's update", () => opts.send({ t: "joined", callId: call.callId, peerId, serverNowMs: place.now() }));
  sendState(call);
  tell(place, { call, change: started ? { kind: "started" } : { kind: "members" } });
  place.roomChanged();
  let left = false;
  return {
    ok: true,
    callId: call.callId,
    peerId,
    leave: () => {
      if (left) return;
      left = true;
      removeMember(place, { callId: call.callId, peerId });
    },
  };
}

/** Remove one member; the call ends with its last. */
export function removeMember(place: Place, opts: { callId: string; peerId: string }): boolean {
  const call = place.getCall();
  if (call?.callId !== opts.callId || !call.members.delete(opts.peerId)) return false;
  if (call.members.size === 0) {
    endCall(place, null);
    return true;
  }
  sendState(call);
  tell(place, { call, change: { kind: "members" } });
  place.roomChanged();
  return true;
}

/** The member `peerId` of call `callId`, only when it belongs to `email`. */
export function memberOf(place: Place, opts: { callId: string; peerId: string; email: string }): LiveMember | null {
  const call = place.getCall();
  if (call?.callId !== opts.callId) return null;
  const member = call.members.get(opts.peerId);
  if (member?.person.email.toLowerCase() !== opts.email.toLowerCase()) return null;
  return member;
}

export function forwardSignal(place: Place, opts: { from: LiveMember; to: string; data: unknown }): boolean {
  const target = place.getCall()?.members.get(opts.to);
  if (target === undefined || opts.to === opts.from.peerId) return false;
  warnOnThrow("a call member's signal", () => target.send({ t: "signal", from: opts.from.peerId, data: opts.data }));
  return true;
}

export function setTranscribing(place: Place, opts: { by: LiveMember; on: boolean }): void {
  const call = place.getCall();
  if (call === null || call.transcribing === opts.on) return;
  call.transcribing = opts.on;
  sendState(call);
  tell(place, { call, change: { kind: "transcribing", by: opts.by.person, atMs: place.now() } });
  place.roomChanged();
}
