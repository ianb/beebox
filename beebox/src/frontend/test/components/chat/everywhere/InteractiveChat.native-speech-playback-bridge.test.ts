// # Native speech playback state
//
// The embedded chat tells the native composer when synthesized speech starts and
// stops. Native uses this to pause continuous dictation before playback and resume
// it after the final queued segment.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  postNativeResponseState,
  postNativeSpeechPlaybackState,
} from "../../../../src/components/chat/everywhere/InteractiveChat/use-native-bridge.js";
import type { NativeShellWindow } from "../../../../src/components/chat/native-post.js";

// The neutral bridge receives both playback edges as JSON payloads:
void test("The neutral bridge receives both playback edges as JSON payloads:", async (t) => {
  // doctest:L18
  const calls: Array<{ channel: string; payload: string }> = [];
  const shell: NativeShellWindow = {
    beeboxNativePost: (channel, payload) => calls.push({ channel, payload }),
  };
  postNativeSpeechPlaybackState(true, shell);
  postNativeSpeechPlaybackState(false, shell);
  t.check(calls, [
    {
      channel: "beeboxSpeechPlaybackState",
      payload: "{\"playing\":true}",
    },
    {
      channel: "beeboxSpeechPlaybackState",
      payload: "{\"playing\":false}",
    },
  ]);
});

// The response-generation edge uses a separate semantic state so native waiting
// ticks stop at the same streaming-to-refreshing boundary as web chat:
void test("The response-generation edge uses a separate semantic state so native waiting...", async (t) => {
  // doctest:L32
  const responseCalls: Array<{ channel: string; payload: string }> = [];
  const responseShell: NativeShellWindow = {
    beeboxNativePost: (channel, payload) => responseCalls.push({ channel, payload }),
  };
  postNativeResponseState(true, responseShell);
  postNativeResponseState(false, responseShell);
  t.check(responseCalls, [
    {
      channel: "beeboxResponseState",
      payload: "{\"active\":true}",
    },
    {
      channel: "beeboxResponseState",
      payload: "{\"active\":false}",
    },
  ]);
});
