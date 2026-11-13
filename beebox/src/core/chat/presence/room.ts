/**
 * Chat presence: who has a chat open right now. One room per chat session per
 * box, held in memory only; a watcher is one live `chatPresence.watch`
 * subscription, so presence is exactly the lifetime of that subscription.
 * Nothing is written to disk. See docs/chat-presence.md.
 */

/** A person present in a chat, as other people in it see them. */
export interface PresentPerson {
  email: string;
  name: string;
}

/**
 * A frame on the `chatPresence.watch` stream. `others` is everyone present
 * except the subscriber. Later kinds (typing, call signaling, ringing) join
 * this union, so a client switches on `t`.
 */
export interface OthersFrame {
  t: "others";
  people: PresentPerson[];
}
export type ChatPresenceFrame = OthersFrame;

export interface Watcher {
  /** Join order across the process; earlier joins sort first. */
  seq: number;
  person: PresentPerson;
}

interface LiveWatcher extends Watcher {
  onChange: (others: PresentPerson[]) => void;
  /** The list last sent to this watcher, to skip sends that change nothing. */
  lastSent: string | null;
}

export interface ChatPresence {
  /**
   * Join a chat's room. `onChange` is called at once with everyone else present,
   * and again whenever that list changes. Returns `leave`, which is idempotent.
   */
  join(opts: { boxRoot: string; sessionId: string; person: PresentPerson; onChange: (others: PresentPerson[]) => void }): () => void;
  /** How many rooms have at least one watcher. */
  size(): number;
}

function sameEmail(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Everyone present except `selfEmail`: one entry per person however many tabs
 * they have open, ordered by each person's earliest join so heads don't jump.
 */
export function othersFor(watchers: readonly Watcher[], selfEmail: string): PresentPerson[] {
  const earliest = new Map<string, Watcher>();
  for (const w of watchers) {
    if (sameEmail(w.person.email, selfEmail)) continue;
    const key = w.person.email.toLowerCase();
    const seen = earliest.get(key);
    if (seen === undefined || w.seq < seen.seq) earliest.set(key, w);
  }
  return [...earliest.values()].toSorted((a, b) => a.seq - b.seq).map((w) => w.person);
}

export function createChatPresence(): ChatPresence {
  const rooms = new Map<string, Map<number, LiveWatcher>>();
  let nextSeq = 1;

  function notify(room: Map<number, LiveWatcher>): void {
    const all = [...room.values()];
    for (const w of all) {
      const others = othersFor(all, w.person.email);
      const key = JSON.stringify(others);
      if (key === w.lastSent) continue;
      w.lastSent = key;
      try {
        w.onChange(others);
      } catch (e) {
        // One subscriber failing must not keep the others from hearing the change.
        console.warn("[chat-presence] a watcher's update failed:", e);
      }
    }
  }

  return {
    join({ boxRoot, sessionId, person, onChange }) {
      const roomKey = `${boxRoot}\0${sessionId}`;
      let room = rooms.get(roomKey);
      if (room === undefined) {
        room = new Map();
        rooms.set(roomKey, room);
      }
      const seq = nextSeq++;
      room.set(seq, { seq, person, onChange, lastSent: null });
      notify(room);
      let left = false;
      return () => {
        if (left) return;
        left = true;
        const current = rooms.get(roomKey);
        if (current === undefined) return;
        current.delete(seq);
        if (current.size === 0) rooms.delete(roomKey);
        else notify(current);
      };
    },
    size() {
      return rooms.size;
    },
  };
}
