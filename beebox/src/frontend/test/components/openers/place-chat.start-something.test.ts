// # When the place page offers "Start something"
//
// The place page shows the place's openers only where a click can send them into
// this place's chat. `startSomething` decides from the chat the page sits beside
// (`PlaceChatContext`), the page's place, and its openers
// (docs/implemented-plans/landmark-arrival.md, Track C, boxholder decisions a and b).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { startSomething } from "../../../src/components/openers/place-chat.js";

const OPENERS = ["Who has what right now?", "Log a new loan"];
const send = () => "accepted" as const;

function chat(contextDir: string | null, showsOwnOpeners: boolean) {
  return { contextDir, showsOwnOpeners, busy: false, sendOpener: send };
}

// ## Outside a chat there is nowhere to send
//
// A landmark card opened on its own page has no chat beside it.
void test("A landmark card opened on its own page has no chat beside it.", async (t) => {
  t.check(startSomething({ payloadDir: "_content/lending", openers: OPENERS, chat: null }), {
    openers: [],
    goToPlace: false,
  });
});

// ## Beside an unstarted chat in the same place, the chat already shows them
//
// The empty chat shows the same openers, so the page does not repeat them
// (decision a).
void test("The empty chat shows the same openers, so the page does not repeat them (deci...", async (t) => {
  t.check(startSomething({ payloadDir: "_content/lending", openers: OPENERS, chat: chat("_content/lending", true) }), {
    openers: [],
    goToPlace: false,
  });
});

// ## Beside a started chat in the same place, the page offers them
//
// Once the chat has a message it no longer shows openers; the page is where they
// stay reachable.
void test("Once the chat has a message it no longer shows openers; the page is where the...", async (t) => {
  t.check(startSomething({ payloadDir: "_content/lending", openers: OPENERS, chat: chat("_content/lending", false) }), {
    openers: [
      "Who has what right now?",
      "Log a new loan",
    ],
    goToPlace: false,
  });
});

// The root place is the logical directory `""`, the same form the chat's
// `contextDir` uses.
void test("The root place is the logical directory \"\", the same form the chat's contextD...", async (t) => {
  t.check(startSomething({ payloadDir: "", openers: ["What can you do?"], chat: chat("", false) }), {
    openers: [
      "What can you do?",
    ],
    goToPlace: false,
  });
});

// ## A place with no openers offers none
void test("A place with no openers offers none", async (t) => {
  t.check(startSomething({ payloadDir: "_content/garden", openers: [], chat: chat("_content/garden", false) }), {
    openers: [],
    goToPlace: false,
  });
});

// ## Beside another place's chat, the page links to this place instead
//
// An opener sent from here would start this place's work in the other place's
// conversation, so the page hides the openers and offers a link to this place's
// chat (decision b). The link is offered whether or not the place has openers:
// it is how the person gets to the place's own chat.
void test("An opener sent from here would start this place's work in the other place's c...", async (t) => {
  t.check(
    ({
      withOpeners: startSomething({ payloadDir: "_content/lending", openers: OPENERS, chat: chat("", false) }),
      without: startSomething({ payloadDir: "_content/garden", openers: [], chat: chat("_content/lending", true) }),
    }),
    {
    withOpeners: {
      openers: [],
      goToPlace: true,
    },
    without: {
      openers: [],
      goToPlace: true,
    },
  },
  );
});
