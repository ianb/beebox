// # Empty-chat openers
//
// An unstarted chat opens on suggestions instead of a bare "start a
// conversation" line: `ChatOpeners` renders the place's openers, and clicking one
// sends it as the person's message.
//
// The frontend doctests run under plain Node with no DOM, so what a click does
// lives in `clickOpener` — a plain function the button's `onClick` calls — and is
// tested directly. The contracts that matter: the sent text is the opener
// verbatim; one accepted click is all there is (the buttons disable on send, so
// an impatient double-click can't queue two turns); a rejected click (a
// draft in the composer, say) leaves the buttons enabled; and a place page's
// standing openers re-arm once the chat beside them has taken the send.

import { test } from "tap";
import "agent-doctest/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatOpeners, clickOpener, latchAfterChatChange, openersDisabled } from "../../../src/components/openers/ChatOpeners.js";

globalThis.React = React;

function markup(openers: string[]): string {
  return renderToStaticMarkup(
    React.createElement(ChatOpeners, { openers, onSendOpener: () => "accepted" as const }),
  );
}

/** A standalone stand-in for the component's `sent` state; `sent()` reads it. */
function clicker(onSendOpener: (text: string) => "accepted" | "rejected") {
  let sent = false;
  const click = (text: string) => clickOpener({ alreadySent: sent, markSent: () => { sent = true; }, onSendOpener }, text);
  return Object.assign(click, { sent: () => sent });
}

// ## An established box — no openers — renders nothing at all
//
// The agent removes the openers once the box is in regular use, and the chat
// falls back to its plain empty-state line. This is the normal end state.
void test("The agent removes the openers once the box is in regular use, and the chat fa...", async (t) => {
  // doctest:L42
  t.check(markup([]), "");
});

// ## Clicking an opener sends that opener's text, verbatim
void test("Clicking an opener sends that opener's text, verbatim", async (t) => {
  // doctest:L49
  const sent: string[] = [];
  const click = clicker((text) => { sent.push(text); return "accepted"; });
  t.check(click("Show me what changed today."), true);

  // doctest:L54
  t.check(sent, [
    "Show me what changed today.",
  ]);
});

// ## A second click sends nothing
//
// Two turns from one impatient double-click was the failure mode; the first send
// latches the whole set off, so the second click is a no-op rather than a second
// message.
void test("Two turns from one impatient double-click was the failure mode; the first sen...", async (t) => {
  // doctest:L65
  const sent: string[] = [];
  const click = clicker((text) => { sent.push(text); return "accepted"; });
  t.check(click("What can you do?"), true);

  // doctest:L70
  t.check(click("What can you do?"), false);

  // doctest:L73
  t.check(click("Let me tell you what this box is for."), false);

  // doctest:L76
  t.check(sent, [
    "What can you do?",
  ]);
});

// ## A rejected click leaves the buttons enabled
//
// The send can refuse: the composer holds a draft, or the chat is still choosing
// its conversation. The set is marked sent only after the send accepts, so a
// refused click does not disable the openers, and the next click (after the
// person clears the draft) is tried again.
void test("The send can refuse:", async (t) => {
  // doctest:L88
  const attempts: string[] = [];
  let draft = "half a thought";
  const click = clicker((text) => { attempts.push(text); return draft === "" ? "accepted" : "rejected"; });
  t.check(click("Log a new loan"), false);

  // doctest:L94
  t.check(click.sent(), false);

  // doctest:L97
  draft = "";
  t.check(click("Log a new loan"), true);

  // doctest:L101
  t.check(click.sent(), true);

  // doctest:L104
  t.check(click("Log a new loan"), false);

  // doctest:L107
  t.check(attempts, [
    "Log a new loan",
    "Log a new loan",
  ]);
});

// ## A place page's openers re-arm after the send
//
// On an empty chat the latch never needs to clear: the list unmounts once the
// first message lands. A place page keeps its openers beside a started chat, so
// there one send must not disable them for good (the 2026-10-09 A-lending walk:
// all three buttons stayed grey after one send). The place page passes
// `standing`, and the latch clears each time the chat beside it changes between
// busy and idle. While the chat is busy with the turn, the buttons stay disabled,
// which covers the double click.
void test("On an empty chat the latch never needs to clear:", async (t) => {
  // doctest:L122
  t.check(latchAfterChatChange({ sent: true, standing: true }), false);

  // doctest:L125
  t.check(latchAfterChatChange({ sent: true, standing: false }), true);
});

// So a place-page opener goes from sent, to busy, to usable again:
void test("So a place-page opener goes from sent, to busy, to usable again:", async (t) => {
  // doctest:L132
  const afterClick = { sent: true, busy: false };
  const chatPicksItUp = { sent: latchAfterChatChange({ sent: afterClick.sent, standing: true }), busy: true };
  const turnEnds = { sent: latchAfterChatChange({ sent: chatPicksItUp.sent, standing: true }), busy: false };
  t.check([afterClick, chatPicksItUp, turnEnds].map(openersDisabled), [
    true,
    true,
    false,
  ]);
});

// The empty chat's set stays disabled through the same changes.
void test("The empty chat's set stays disabled through the same changes.", async (t) => {
  // doctest:L142
  const chatPicksItUp = { sent: latchAfterChatChange({ sent: true, standing: false }), busy: false };
  t.check(openersDisabled(chatPicksItUp), true);
});
