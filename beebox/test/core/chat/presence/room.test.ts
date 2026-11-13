// Chat presence rooms: who else has a chat open. Each watcher hears everyone
// present except itself, one entry per person, earliest arrival first; a
// change that leaves a watcher's list the same sends it nothing; the room is
// forgotten when its last watcher leaves.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createChatPresence, othersFor, type ChatPresenceFrame, type PresentPerson } from "../../../../src/core/chat/presence/room.js";

const priya = { email: "priya@example.com", name: "Priya Marlowe" };
const tomas = { email: "tomas@example.com", name: "Tomas Marlowe" };
const odette = { email: "odette@example.com", name: "Odette Marlowe" };

function ignore(): void {
  // This watcher's updates are not under test.
}

/** Records each `others` list a watcher hears, ignoring `call` frames. */
function recorder() {
  const seen: PresentPerson[][] = [];
  return {
    seen,
    onFrame: (frame: ChatPresenceFrame) => {
      if (frame.t === "others") seen.push(frame.people);
    },
  };
}

void test("othersFor drops the subscriber, dedupes by email, and orders by earliest join", (t) => {
  t.check(
    othersFor(
      [
        { seq: 3, person: odette },
        { seq: 1, person: priya },
        { seq: 2, person: tomas },
        // Tomas's second tab, and Priya under a differently cased email.
        { seq: 4, person: tomas },
        { seq: 5, person: { email: "PRIYA@example.com", name: "Priya Marlowe" } },
      ],
      "priya@example.com",
    ),
    [tomas, odette],
  );
  t.end();
});

void test("joining and leaving tells the others, and the room empties", (t) => {
  const presence = createChatPresence();
  const p = recorder();
  const tm = recorder();
  const leaveP = presence.join({ boxRoot: "/box", sessionId: "s-1", person: priya, ...p });
  const leaveT = presence.join({ boxRoot: "/box", sessionId: "s-1", person: tomas, ...tm });
  leaveT();
  t.check(p.seen, [[], [tomas], []]);
  t.check(tm.seen, [[priya]]);
  t.check(presence.size(), 1);
  leaveP();
  // A second leave is harmless.
  leaveP();
  t.check(presence.size(), 0);
  t.end();
});

void test("a person's second tab changes nothing for the others", (t) => {
  const presence = createChatPresence();
  const p = recorder();
  presence.join({ boxRoot: "/box", sessionId: "s-1", person: priya, ...p });
  const leaveTab1 = presence.join({ boxRoot: "/box", sessionId: "s-1", person: tomas, onFrame: ignore });
  const tab2 = recorder();
  presence.join({ boxRoot: "/box", sessionId: "s-1", person: tomas, ...tab2 });
  leaveTab1();
  // Priya heard Tomas arrive once; his second tab and closing the first sent nothing.
  t.check(p.seen, [[], [tomas]]);
  // Tomas's own tabs never list him.
  t.check(tab2.seen, [[priya]]);
  t.end();
});

void test("rooms are per chat and per box", (t) => {
  const presence = createChatPresence();
  const p = recorder();
  presence.join({ boxRoot: "/box", sessionId: "s-1", person: priya, ...p });
  presence.join({ boxRoot: "/box", sessionId: "s-2", person: tomas, onFrame: ignore });
  presence.join({ boxRoot: "/other-box", sessionId: "s-1", person: odette, onFrame: ignore });
  t.check(p.seen, [[]]);
  t.check(presence.size(), 3);
  t.end();
});

void test("one watcher throwing does not keep the others from hearing", (t) => {
  const presence = createChatPresence();
  const warnings: unknown[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args[0]);
  t.teardown(() => {
    console.warn = warn;
  });
  presence.join({ boxRoot: "/box", sessionId: "s-1", person: priya, onFrame: (frame) => {
    if (frame.t === "others" && frame.people.length > 0) throw new Error("socket gone");
  } });
  const o = recorder();
  presence.join({ boxRoot: "/box", sessionId: "s-1", person: odette, ...o });
  presence.join({ boxRoot: "/box", sessionId: "s-1", person: tomas, onFrame: ignore });
  t.check(o.seen, [[priya], [priya, tomas]]);
  t.check(warnings, ["[chat-presence] a watcher's update failed:", "[chat-presence] a watcher's update failed:"]);
  t.end();
});
