// # The selected conversation's transcript, shared with ambient replies
//
// Ambient replies record which reply of the selected conversation the user has
// seen. They read that conversation from the open chat instead of fetching its
// history and status again. Two rules keep the record right: the transcript is
// offered only after the chat's first history load (an empty transcript seen
// first would become the baseline, and the real reply would then read as new),
// and only to the ambient reply for that same session.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionEntry } from "../../../../src/api.js";
import { SelectedTranscriptRegion, useSelectedTranscript } from "../../../../src/components/chat/ambient/selected-transcript.js";

globalThis.React = React;

function Probe({ sessionId }: { sessionId: string }) {
  const transcript = useSelectedTranscript(sessionId);
  return React.createElement("span", null, transcript === null ? "none" : `${transcript.total}:${transcript.busy}`);
}

function render({ loaded, probeFor }: { loaded: boolean; probeFor: string }) {
  const entries: SessionEntry[] = [{ type: "user", uuid: "u1", timestamp: "2026-01-01T00:00:00Z", content: [{ type: "text", text: "Hello" }] }];
  return renderToStaticMarkup(React.createElement(SelectedTranscriptRegion, {
    sessionId: "chat-a", loaded, entries, total: 1, busy: false,
    children: React.createElement(Probe, { sessionId: probeFor }),
  }));
}

// Once the chat has loaded, the ambient reply for the open conversation gets its transcript:
void test("Once the chat has loaded, the ambient reply for the open conversation gets it...", async (t) => {
  // doctest:L35
  t.check(render({ loaded: true, probeFor: "chat-a" }), "<span>1:false</span>");
});

// Before the first history load finishes, it gets nothing, and keeps waiting:
void test("Before the first history load finishes, it gets nothing, and keeps waiting:", async (t) => {
  // doctest:L42
  t.check(render({ loaded: false, probeFor: "chat-a" }), "<span>none</span>");
});

// Another conversation's ambient reply never sees it, and fetches its own:
void test("Another conversation's ambient reply never sees it, and fetches its own:", async (t) => {
  // doctest:L49
  t.check(render({ loaded: true, probeFor: "chat-b" }), "<span>none</span>");
});
