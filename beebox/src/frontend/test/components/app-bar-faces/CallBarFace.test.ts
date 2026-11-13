// # The call bar
//
// `CallBarFace` draws a call this tab can join, this tab's own call with its
// controls and each person's connection, or how a call ended
// (docs/plans/chat-calls.md, Track D). Checked as the text a person reads,
// plus which toggles are pressed.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CallBarFace, type CallBarActions } from "../../../src/components/app-bar-faces/CallBarFace.js";
import { CallButtonFace } from "../../../src/components/app-bar-faces/CallButtonFace.js";
import type { CallBarView, InCall } from "../../../src/lib/call-state.js";

globalThis.React = React;

const noop = async (): Promise<void> => {};
const actions: CallBarActions = {
  handleJoin: noop, handleLeave: () => {}, handleMute: () => {}, handleCamera: noop, handleTranscribe: noop, handleRetryMic: noop,
};

function shown(view: CallBarView): { text: string; pressed: string[] } {
  const html = renderToStaticMarkup(React.createElement(CallBarFace, { view, actions }));
  const text = html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
  const pressed = [...html.matchAll(/id="bbx-call-(\w+)"[^>]*aria-pressed="true"/g)].map((m) => m[1] ?? "");
  return { text, pressed };
}

const call: InCall = {
  phase: "in-call", sessionId: "s1", callId: "call-1", selfPeerId: "peer-b", clockOffsetMs: 0,
  members: [{ peerId: "peer-a", person: { email: "tomas@example.com", name: "Tomas Marlowe" } }, { peerId: "peer-b", person: { email: "priya@example.com", name: "Priya Okafor" } }],
  everJoined: true, links: { "peer-a": { state: "failed", cause: "no-relay" } },
  mic: "muted", camera: "off", transcribing: true, recording: { state: "failed", message: "registration refused" }, relay: false,
};

void test("a ringing call offers Join and says whether it is transcribed", (t) => {
  t.check(shown({ kind: "ringing", callId: "c", people: ["Tomas Marlowe"], transcribing: true, full: false }), {
    text: "Tomas Marlowe is calling Transcribing Join", pressed: [],
  });
  t.check(shown({ kind: "going", callId: "c", people: ["Tomas Marlowe", "Odette Marlowe", "Juniper Marlowe"], transcribing: false, full: true }).text,
    "Tomas Marlowe, Odette Marlowe and Juniper Marlowe are on a call Call is full (3).");
  t.end();
});

// The plan: a failed connection names the person and, without a relay, says so; a recording failure shows in the bar.
void test("in a call: who is on, a failed connection with its cause, and the pressed toggles", (t) => {
  t.check(shown({ kind: "in-call", call }), {
    text: "T Tomas Marlowe Can't connect to Tomas Marlowe. This box has no relay for calls; ask the boxholder to add one. Transcribing Mute Camera Transcribe Leave Transcription is not recording your microphone: registration refused",
    pressed: ["mute", "transcribe"],
  });
  t.end();
});

void test("another tab on the call, and how a call ended", (t) => {
  t.check(shown({ kind: "other-tab", transcribing: false }).text, "On the call in another tab.");
  t.check(shown({ kind: "ended", reason: "no-answer" }).text, "No one joined. Dismiss");
  t.check(shown({ kind: "none" }).text, "");
  t.end();
});

void test("the phone button names its action", (t) => {
  const label = (offer: "start" | "join" | null) => /aria-label="([^"]*)"/.exec(renderToStaticMarkup(React.createElement(CallButtonFace, { offer, onCall: noop })))?.[1] ?? null;
  t.check([label("start"), label("join"), label(null)], ["Start a call", "Join the call", null]);
  t.end();
});
