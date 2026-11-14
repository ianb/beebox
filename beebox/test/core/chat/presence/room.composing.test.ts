// Composing in a chat presence room: a person present says they are
// typing or dictating, and everyone else in the room hears it as an
// `composing` frame. It clears when they say so, when its expiry passes
// without a refresh, and when their last tab leaves. Someone not present
// cannot set one, and nobody hears their own.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { COMPOSING_TTL_MS, createChatPresence, type ComposingFrame, type ChatPresenceFrame } from "../../../../src/core/chat/presence/room.js";

const priya = { email: "priya@example.com", name: "Priya Marlowe" };
const tomas = { email: "tomas@example.com", name: "Tomas Marlowe" };
const box = { boxRoot: "/box", sessionId: "s-1" };

function setup() {
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const presence = createChatPresence({
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const fire = () => {
    for (const timer of timers.splice(0)) if (!timer.cancelled) timer.fn();
  };
  return { presence, timers, fire };
}

function ignore(): void {
  // This watcher's frames are not under test.
}

/** Records each `composing` list a watcher hears. */
function recorder() {
  const seen: ComposingFrame["active"][] = [];
  return {
    seen,
    onFrame: (frame: ChatPresenceFrame) => {
      if (frame.t === "composing") seen.push(frame.active);
    },
  };
}

void test("typing, then dictating, then stopping reaches the others but not the person", (t) => {
  const { presence } = setup();
  const p = recorder();
  const tm = recorder();
  presence.join({ ...box, person: priya, ...p });
  presence.join({ ...box, person: tomas, ...tm });
  t.check(presence.setComposing({ ...box, email: tomas.email, doing: "typing" }), true);
  // A refresh with the same state sends nothing new.
  presence.setComposing({ ...box, email: tomas.email, doing: "typing" });
  presence.setComposing({ ...box, email: "TOMAS@example.com", doing: "dictating" });
  presence.setComposing({ ...box, email: tomas.email, doing: null });
  t.check(p.seen, [[], [{ email: tomas.email, doing: "typing" }], [{ email: tomas.email, doing: "dictating" }], []]);
  t.check(tm.seen, [[]]);
  t.end();
});

void test("a composing state not refreshed clears at its expiry; a refresh moves the expiry", (t) => {
  const { presence, timers, fire } = setup();
  const p = recorder();
  presence.join({ ...box, person: priya, ...p });
  presence.join({ ...box, person: tomas, onFrame: ignore });
  presence.setComposing({ ...box, email: tomas.email, doing: "typing" });
  presence.setComposing({ ...box, email: tomas.email, doing: "typing" });
  t.check(timers.map((x) => [x.ms, x.cancelled]), [[COMPOSING_TTL_MS, true], [COMPOSING_TTL_MS, false]]);
  fire();
  t.check(p.seen, [[], [{ email: tomas.email, doing: "typing" }], []]);
  t.end();
});

void test("leaving clears what they were composing once the person's last tab is gone", (t) => {
  const { presence, timers } = setup();
  const p = recorder();
  presence.join({ ...box, person: priya, ...p });
  const leaveTab1 = presence.join({ ...box, person: tomas, onFrame: ignore });
  const leaveTab2 = presence.join({ ...box, person: tomas, onFrame: ignore });
  presence.setComposing({ ...box, email: tomas.email, doing: "typing" });
  leaveTab1();
  t.check(p.seen, [[], [{ email: tomas.email, doing: "typing" }]]);
  leaveTab2();
  t.check(p.seen, [[], [{ email: tomas.email, doing: "typing" }], []]);
  t.check(timers.map((x) => x.cancelled), [true]);
  t.end();
});

void test("someone not present, or present in another chat, cannot say they are composing", (t) => {
  const { presence } = setup();
  const p = recorder();
  presence.join({ ...box, person: priya, ...p });
  presence.join({ boxRoot: "/box", sessionId: "s-2", person: tomas, onFrame: ignore });
  presence.join({ boxRoot: "/other-box", sessionId: "s-1", person: tomas, onFrame: ignore });
  t.check(presence.setComposing({ ...box, email: tomas.email, doing: "typing" }), false);
  t.check(presence.setComposing({ boxRoot: "/box", sessionId: "s-3", email: tomas.email, doing: "typing" }), false);
  t.check(p.seen, [[]]);
  // The refused call into an empty chat left no room behind.
  t.check(presence.size(), 3);
  t.end();
});
