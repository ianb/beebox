/**
 * Dev-only test harness for the speech replay menu + playback pipeline.
 *
 * Renders the real SpeechMenu against the real useSpeechPlayback hook and
 * TTSClient, but points the client at the backend's mock TTS (slow fixture
 * audio). It installs window.__speechTestLog / window.__speechState so an
 * external driver (scripts/test-speech-browser.sh, via bin/browse) can click
 * the menu and assert playback behavior and timing.
 *
 * Not part of the product — only mounted under /dev/speech in dev builds.
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { SpeechMenu } from "../../../components/chat/SpeechMenu";
import { useSpeechPlayback } from "../../../hooks/useSpeechPlayback";
import { getTTSClient } from "../../../lib/tts-client";
import { logSpeechEvent } from "../../../lib/speech-test-log";
import type { SpeechSegment } from "../../../lib/speech-parsing";

// Distinct text per segment so the mock picks distinct fixtures and the test
// log labels (first chars of text) are recognizable. Must NOT start with
// "stream" — see the playing-match logic in InteractiveChat.
const MESSAGE_ID = "speech-test-msg";
const SEGMENTS: SpeechSegment[] = [
  { text: "This is the first segment of the test speech.", displayText: "This is the first segment of the test speech.", hasTextBefore: false },
  { text: "And now here is the second segment, a little different.", displayText: "And now here is the second segment, a little different.", hasTextBefore: false },
  { text: "Finally, this is the third and last segment.", displayText: "Finally, this is the third and last segment.", hasTextBefore: false },
];

export function SpeechTestHarness() {
  const sp = useSpeechPlayback();
  const [logVersion, setLogVersion] = useState(0);

  // Install the observability globals and point the TTS client at the mock.
  // Mock timing is tunable via URL query (?delayMs=&chunkMs=&chunkSize=) so
  // the driver can dial in a stream slow enough to make streaming playback's
  // head start visibly precede the download completing.
  useEffect(() => {
    window.__speechTestLog = [];
    const params = new URLSearchParams(window.location.search);
    const num = (name: string, fallback: number) => {
      const raw = params.get(name);
      const parsed = raw === null ? NaN : Number(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const tts = getTTSClient();
    tts.setTestRequestExtras({
      mock: true,
      delayMs: num("delayMs", 500),
      chunkMs: num("chunkMs", 80),
      chunkSize: num("chunkSize", 4096),
    });
    // No personality config loads here; release the config gate so playback
    // doesn't wait forever for it.
    tts.markConfigLoaded();
    setLogVersion((v) => v + 1);
  }, []);

  const playing = sp.isPlaying && sp.playingMessageId === MESSAGE_ID;

  // Mirror hook state onto the window for the external driver to assert on.
  useEffect(() => {
    window.__speechState = {
      isPlaying: sp.isPlaying,
      playingMessageId: sp.playingMessageId,
      remainingCount: sp.remainingCount,
    };
  });

  // Expose imperative hook handles so the driver can isolate playback logic
  // from the menu UI when debugging.
  useEffect(() => {
    window.__speechHarness = {
      play: () => sp.playSegments({ messageId: MESSAGE_ID, segments: SEGMENTS }),
      replay: (fromIndex: number) => sp.replay({ messageId: MESSAGE_ID, segments: SEGMENTS, fromIndex }),
      skip: () => sp.skip(),
      stop: () => sp.stop(),
    };
  });

  const log = useMemo(() => {
    void logVersion;
    return typeof window !== "undefined" && window.__speechTestLog ? window.__speechTestLog : [];
  }, [logVersion]);

  return (
    <div className="p-6 flex flex-col gap-4 max-w-2xl">
      <h1 className="text-xl font-bold text-warm-900">Speech menu test harness</h1>
      <p className="text-sm text-warm-600">
        Mocked slow TTS (500ms delay, 80ms/chunk). Use the speaker menu to Stop,
        Fast-forward, Replay, and Replay-from. Events are recorded on
        <code className="px-1">window.__speechTestLog</code>.
      </p>

      <div className="flex items-center gap-3">
        <Button
          intent="primary"
          onClick={() => sp.playSegments({ messageId: MESSAGE_ID, segments: SEGMENTS })}
          data-testid="play-all"
        >
          Play all
        </Button>
        <span data-testid="speaker-menu" className="inline-flex items-center">
          <SpeechMenu
            segments={SEGMENTS}
            playing={playing}
            anyPlaying={sp.isPlaying}
            canSkip={Boolean(sp.isPlaying && sp.remainingCount > 1)}
            onStop={() => { logSpeechEvent("menu.stop"); sp.stop(); }}
            onSkip={() => { logSpeechEvent("menu.skip"); sp.skip(); }}
            onReplay={(fromIndex) => { logSpeechEvent("menu.replay", { fromIndex }); sp.replay({ messageId: MESSAGE_ID, segments: SEGMENTS, fromIndex }); }}
          />
        </span>
        <Button
          intent="ghost"
          onClick={() => { if (window.__speechTestLog) window.__speechTestLog.length = 0; setLogVersion((v) => v + 1); }}
          data-testid="reset-log"
        >
          Reset log
        </Button>
      </div>

      <div className="text-sm text-warm-700">
        <div data-testid="state">
          isPlaying={String(sp.isPlaying)} playingMessageId={String(sp.playingMessageId)} remaining={sp.remainingCount}
        </div>
      </div>

      <pre data-testid="log" className="text-xs bg-warm-50 border border-warm-200 rounded p-3 overflow-auto max-h-96">
        {log.map((e) => `${e.t.toFixed(0)}ms  ${e.event}  ${JSON.stringify(e.detail)}`).join("\n")}
      </pre>
    </div>
  );
}
