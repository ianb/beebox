// # Native narration state
//
// The embedded chat tells the native composer whether the current session has
// narration mode enabled. The native side defaults to off; this message only
// changes which transcript is used after a voice keyword send.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { postNativeHqDictationState, postNativeNarrationState } from "../../../../src/components/chat/everywhere/InteractiveChat/use-native-bridge.js";
import type { NativeShellWindow } from "../../../../src/components/chat/native-post.js";

// The HQ state channel carries `diarized`: the box's HQ service labels
// speakers, which keeps native's HQ pass on the box instead of on the device.
// `enabled` is always true — every dictated message gets the HQ pass
// (docs/plans/hq-always.md) — and is still sent for native builds that read it:
void test("The HQ state channel carries diarized:", async (t) => {
  // doctest:L18
  const calls: Array<{ channel: string; payload: string }> = [];
  const shell: NativeShellWindow = {
    beeboxNativePost: (channel, payload) => calls.push({ channel, payload }),
  };
  postNativeHqDictationState({ diarized: false }, shell);
  postNativeHqDictationState({ diarized: true }, shell);
  t.check(calls, [
    {
      channel: "beeboxHqDictationState",
      payload: "{\"enabled\":true,\"diarized\":false}",
    },
    {
      channel: "beeboxHqDictationState",
      payload: "{\"enabled\":true,\"diarized\":true}",
    },
  ]);
});

// The neutral bridge receives the current state as a JSON payload:
void test("The neutral bridge receives the current state as a JSON payload:", async (t) => {
  // doctest:L31
  const calls: Array<{ channel: string; payload: string }> = [];
  const shell: NativeShellWindow = {
    beeboxNativePost: (channel, payload) => calls.push({ channel, payload }),
  };
  postNativeNarrationState(false, shell);
  postNativeNarrationState(true, shell);
  t.check(calls, [
    {
      channel: "beeboxNarrationState",
      payload: "{\"enabled\":false}",
    },
    {
      channel: "beeboxNarrationState",
      payload: "{\"enabled\":true}",
    },
  ]);
});
