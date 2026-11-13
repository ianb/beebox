/**
 * Chat presence and calls: who has a chat open right now, and the call going
 * on in it. One room per chat session per box, held in memory only.
 *
 * A watcher is one live `chatPresence.watch` subscription, so presence is
 * exactly the lifetime of that subscription. A call member is one live
 * `chatCall.join` subscription; being on a call does not need the chat to be
 * focused, so the two are separate. Nothing here is written to disk.
 * See docs/chat-presence.md and docs/chat-calls.md.
 */

import type { ChatPresence, ChatPresenceFrame, ChatPresenceOptions, MemberRef, PresentPerson } from "./types.js";
import { othersFor, type Watcher } from "./others.js";
import { callSummary, forwardSignal, joinCall, memberOf, removeMember, setTranscribing, warnOnThrow, type Call, type Place } from "./call.js";

export type * from "./types.js";
export { CALL_MEMBER_CAP, NO_ANSWER_MS } from "./types.js";
export { othersFor, type Watcher } from "./others.js";

interface LiveWatcher extends Watcher {
  onFrame: (frame: ChatPresenceFrame) => void;
  /** Each kind's last sent value, to skip sends that change nothing. */
  lastSent: { others: string | null; call: string | null };
}

interface Room {
  watchers: Map<number, LiveWatcher>;
  call: Call | null;
}

function notifyWatchers(room: Room): void {
  const all = [...room.watchers.values()];
  const call = callSummary(room.call);
  const callKey = JSON.stringify(call);
  for (const w of all) {
    const others = othersFor(all, w.person.email);
    const othersKey = JSON.stringify(others);
    if (othersKey !== w.lastSent.others) {
      w.lastSent.others = othersKey;
      warnOnThrow("a watcher's update", () => w.onFrame({ t: "others", people: others }));
    }
    if (callKey !== w.lastSent.call) {
      w.lastSent.call = callKey;
      warnOnThrow("a watcher's update", () => w.onFrame({ t: "call", call }));
    }
  }
}

function defaultTimer(fn: () => void, ms: number): () => void {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
}

export function createChatPresence(options?: ChatPresenceOptions): ChatPresence {
  const now = options?.now ?? Date.now;
  const setTimer = options?.setTimer ?? defaultTimer;
  const newId = options?.newId ?? (() => crypto.randomUUID());
  const rooms = new Map<string, Room>();
  let seq = 1;
  const nextSeq = (): number => seq++;

  /** The room for a chat, made on first use; dropped again by `roomChanged` once it holds nothing. */
  function placeFor(boxRoot: string, sessionId: string): { room: Room; place: Place } {
    const key = `${boxRoot}\0${sessionId}`;
    let room = rooms.get(key);
    if (room === undefined) {
      room = { watchers: new Map(), call: null };
      rooms.set(key, room);
    }
    const held = room;
    const place: Place = {
      boxRoot,
      sessionId,
      getCall: () => held.call,
      setCall: (call) => {
        held.call = call;
      },
      roomChanged: () => {
        notifyWatchers(held);
        if (held.watchers.size === 0 && held.call === null && rooms.get(key) === held) rooms.delete(key);
      },
      now,
      setTimer,
      newId,
      nextSeq,
      onCallChange: options?.onCallChange,
    };
    return { room: held, place };
  }

  function member(ref: MemberRef): { place: Place; found: ReturnType<typeof memberOf> } {
    const { place } = placeFor(ref.boxRoot, ref.sessionId);
    const found = memberOf(place, ref);
    if (found === null) place.roomChanged();
    return { place, found };
  }

  return {
    join({ boxRoot, sessionId, person, onFrame }: { boxRoot: string; sessionId: string; person: PresentPerson; onFrame: (frame: ChatPresenceFrame) => void }) {
      const { room, place } = placeFor(boxRoot, sessionId);
      const id = nextSeq();
      room.watchers.set(id, { seq: id, person, onFrame, lastSent: { others: null, call: null } });
      place.roomChanged();
      let left = false;
      return () => {
        if (left) return;
        left = true;
        room.watchers.delete(id);
        place.roomChanged();
      };
    },
    joinCall({ boxRoot, sessionId, ...opts }) {
      return joinCall(placeFor(boxRoot, sessionId).place, opts);
    },
    signal(from, { to, data }) {
      const { place, found } = member(from);
      return found !== null && forwardSignal(place, { from: found, to, data });
    },
    setTranscribing(ref, on) {
      const { place, found } = member(ref);
      if (found === null) return false;
      setTranscribing(place, { by: found, on });
      return true;
    },
    leaveCall(ref) {
      const { place, found } = member(ref);
      return found !== null && removeMember(place, ref);
    },
    size() {
      return rooms.size;
    },
  };
}
