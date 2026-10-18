// # Web→native shell posting
//
// Receipts, location results, and session reports cross from the embedded web
// chat to the native shell through one neutral function,
// `beeboxNativePost(channel, payload)`, defined by each shell's
// document-start script (`docs/mobile-contract.md`). Payloads always cross the
// neutral path as strings. A shell that predates the neutral function — an older
// installed iOS build — instead receives the legacy WKScriptMessageHandler
// object form, so no installed build ever loses receipts during the transition.

import { test } from "tap";
import "agent-doctest/tap";
import { postNativeMessage } from "../../../src/components/chat/native-post.js";
import type { NativeShellWindow } from "../../../src/components/chat/native-post.js";

// When the shell defines the neutral function, it receives the channel name and
// a JSON string of the payload:
void test("When the shell defines the neutral function, it receives the channel name and...", async (t) => {
  // doctest:L20
  const neutralCalls: { channel: string; payload: string }[] = [];
  const neutralShell: NativeShellWindow = {
    beeboxNativePost: (channel, payload) => neutralCalls.push({ channel, payload }),
  };
  postNativeMessage(neutralShell, {
    channel: "beeboxEmissionReceipt",
    payload: { disposition: "sent", emissionId: "abc", deduplicated: false },
  });
  t.check(neutralCalls, [
    {
      channel: "beeboxEmissionReceipt",
      payload: "{\"disposition\":\"sent\",\"emissionId\":\"abc\",\"deduplicated\":false}",
    },
  ]);

  // A payload that is already a string (the session href) is passed through
  // unwrapped, not double-encoded:

  // doctest:L36
  neutralCalls.length = 0;
  postNativeMessage(neutralShell, {
    channel: "beeboxSession",
    payload: "https://box.example/chat?session=s1",
  });
  t.check(neutralCalls, [
    {
      channel: "beeboxSession",
      payload: "https://box.example/chat?session=s1",
    },
  ]);

  // Without the neutral function, the legacy webkit handler for that channel gets
  // the original object — and the neutral form is preferred when both exist:

  // doctest:L49
  neutralCalls.length = 0;
  const legacyCalls: unknown[] = [];
  const legacyShell: NativeShellWindow = {
    webkit: {
      messageHandlers: {
        beeboxLocationResult: { postMessage: (message) => legacyCalls.push(message) },
      },
    },
  };
  postNativeMessage(legacyShell, {
    channel: "beeboxLocationResult",
    payload: { id: "req-1", success: true, enabled: true, message: "Location sharing is on." },
  });
  const bothShell: NativeShellWindow = {
    beeboxNativePost: (channel, payload) => neutralCalls.push({ channel, payload }),
    webkit: legacyShell.webkit,
  };
  postNativeMessage(bothShell, {
    channel: "beeboxLocationResult",
    payload: { id: "req-2", success: false, enabled: false, message: "Denied." },
  });
  t.check({ legacy: legacyCalls, neutral: neutralCalls.map((c) => c.channel) }, {
    legacy: [
      {
        id: "req-1",
        success: true,
        enabled: true,
        message: "Location sharing is on.",
      },
    ],
    neutral: [
      "beeboxLocationResult",
    ],
  });

  // A shell exposing neither surface (a plain browser tab) is a silent no-op —
  // the bridges are only enabled under `nativeComposer=1`, so there is nothing to
  // deliver to:

  // doctest:L79
  postNativeMessage({}, { channel: "beeboxSession", payload: "https://box.example/chat" });
  t.check("no throw", "no throw");
});
