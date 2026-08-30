/**
 * Dev-only harness for capture mode (Track 4).
 *
 * Exercises the two capture-mode surfaces in isolation — no mic, camera, or
 * backend:
 *   - the pending capture bubble in every state, with scripted `capture-status`
 *     transitions (preparing → transcribing → queued → delivered / failed);
 *   - the delivered capture chip as it renders in the transcript;
 *   - the full-screen capture overlay, mounted against an in-memory fake
 *     `CaptureApi` (create/upload/finalize/cancel are no-ops) so Done/Cancel and
 *     the control chrome are clickable without a device.
 *
 * The bubble/chip components take all state as props, so this stays prop-typed
 * against them and breaks the typecheck if their contracts change. Not part of
 * the product — only mounted under /dev/capture-mode in dev builds (router.tsx).
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { CaptureBubbleView, type CaptureBubbleModel, type CaptureLiveStatus } from "../../../components/chat/capture-bubble";
import { RESOLVED_HOLD_MS } from "../../../components/chat/useCaptureBubbles";
import { CaptureChip } from "../../../components/chat/CaptureChip";
import { UserMessage } from "../../../components/chat/user-message";
import { CaptureOverlay } from "../../../components/capture/CaptureOverlay";
import { CaptureControls } from "../../../components/capture/CaptureControls";
import type { RetryFeedback } from "../../capture/retry-feedback";
import { CaptureApiProvider, type CaptureApi } from "../../capture/capture-api-context";
import { parseCaptureWrapper } from "../../../components/chat/capture-message";
import { UploadAbortedError } from "../../../lib/binary-upload";
import type { SessionEntry } from "../../../api";

const COUNTS = { photos: 2, files: 1, audioSegments: 3 };

/**
 * A fixed clock, so the aged faces are reproducible: every model below states
 * its `startedAt` relative to this rather than to the wall clock.
 */
const HARNESS_NOW = Date.parse("2026-08-21T12:00:00Z");
const minutesAgo = (m: number) => new Date(HARNESS_NOW - m * 60_000).toISOString();

/**
 * When the capture started, and when it last changed. They differ whenever a
 * capture was retried — the failed caption ages from the second, so an old
 * capture that failed again a minute ago reads as a fresh failure.
 */
const times = (startedMin: number, activityMin: number) => ({
  startedAt: minutesAgo(startedMin),
  lastActivityAt: minutesAgo(activityMin),
});
const DAY_MIN = 24 * 60;
const SECONDS_AGO = new Date(HARNESS_NOW - 10_000).toISOString();

/** Canonical bubble states, one per face the pending bubble can wear. */
const BUBBLE_STATES: Array<{ label: string; model: CaptureBubbleModel }> = [
  { label: "preparing", model: { id: "b1", state: "preparing", counts: COUNTS, ...times(0, 0) } },
  { label: "transcribing (live)", model: { id: "b2", state: "preparing", counts: COUNTS, ...times(0, 0), liveStatus: "transcribing" } },
  { label: "queued (delivering)", model: { id: "b3", state: "delivering", counts: COUNTS, ...times(0, 0) } },
  { label: "working, past patience — reports its age", model: { id: "b4", state: "preparing", counts: COUNTS, ...times(4, 4) } },
  { label: "delivered (held 3s in place, then leaves)", model: { id: "b5", state: "delivering", counts: COUNTS, ...times(2, 0), resolution: "delivered" } },
  { label: "discarded (same, after the user discards)", model: { id: "b6", state: "failed:prepare", counts: COUNTS, ...times(90, 30), resolution: "discarded" } },
  { label: "failed, fresh — retry emphasized", model: { id: "b7", state: "failed:deliver", counts: COUNTS, ...times(3, 3) } },
  { label: "old capture, failed again a minute ago — still fresh", model: { id: "b8", state: "failed:deliver", counts: COUNTS, ...times(20 * DAY_MIN, 1) } },
  { label: "failed, aged past the sweep's window — discard emphasized", model: { id: "b9", state: "failed:prepare", counts: { photos: 7, files: 0, audioSegments: 1 }, ...times(16 * DAY_MIN, 16 * DAY_MIN) } },
  { label: "a discard that came back with an error", model: { id: "b10", state: "failed:prepare", counts: COUNTS, ...times(120, 120), actionError: "couldn't discard — Cancel failed: 409" } },
  { label: "photos only", model: { id: "b11", state: "preparing", counts: { photos: 3, files: 0, audioSegments: 0 }, ...times(0, 0) } },
];

/** The harness has no backend, so both verbs just announce themselves. */
const announce = (verb: string) => async (id: string) => {
  window.alert(`${verb} ${id}`);
};

/** How the fake transport behaves — the field conditions worth reproducing. */
interface FakeUploadBehavior {
  /** Seconds each upload takes, ticking progress the whole way. */
  seconds: number;
  /** Fail every upload (after its full duration), as a dead link would. */
  fail: boolean;
}

const PROGRESS_TICK_MS = 200;

/**
 * The live transport knobs, read at upload time so toggling the controls
 * affects the next transfer (that's how you watch a healthy queue turn into a
 * failing one without reopening the overlay). Module-level rather than a ref:
 * this harness is a singleton dev page, and the mutable box has nothing to do
 * with rendering.
 */
const fakeBehavior: FakeUploadBehavior = { seconds: 4, fail: false };

/**
 * A faithful upload double: it takes real time, reports real progress, and
 * honours the abort signal. An instant-resolving fake cannot show any of the
 * behaviour that actually broke in the field — serialization, the percentage
 * readout, Done-while-uploads-are-pending, or Skip.
 */
async function fakeUpload(opts: {
  behavior: FakeUploadBehavior;
  signal: AbortSignal | undefined;
  onProgress: ((event: { loaded: number; total: number }) => void) | undefined;
}): Promise<void> {
  const { behavior, signal, onProgress } = opts;
  const total = 8 * 1024 * 1024;
  const ticks = Math.max(1, Math.round((behavior.seconds * 1000) / PROGRESS_TICK_MS));
  for (let tick = 1; tick <= ticks; tick++) {
    await new Promise((r) => setTimeout(r, PROGRESS_TICK_MS));
    if (signal?.aborted) throw new UploadAbortedError();
    onProgress?.({ loaded: Math.round((total * tick) / ticks), total });
  }
  if (behavior.fail) throw new FakeUploadError();
}

/** The fake transport's stand-in for a link that never completes a transfer. */
class FakeUploadError extends Error {
  constructor() {
    super("Fake upload failed (dev harness)");
    this.name = "FakeUploadError";
  }
}

/** In-memory fake so the overlay mounts with no mic/camera/backend. */
function makeFakeApi(opts: { log: (line: string) => void }): CaptureApi {
  const { log } = opts;
  return {
    createCaptureSession: async (targetSessionId) => {
      log(`createCaptureSession(target=${String(targetSessionId)})`);
      return {
        sessionId: `fake-${Math.random().toString(36).slice(2, 8)}`,
        startedAt: new Date().toISOString(),
        capabilities: {
          acceptedAudioFormats: ["webm-opus", "m4a-aac"],
          acceptedUploadEncodings: ["raw-body-v1"],
        },
      };
    },
    finalizeCaptureSession: async (id) => { log(`finalize(${id})`); },
    cancelCaptureSession: async (id) => { log(`cancel(${id})`); },
    uploadCaptureFile: async (uploadOpts) => {
      log(`upload start (${uploadOpts.kind} ${uploadOpts.filename})`);
      try {
        await fakeUpload({
          behavior: fakeBehavior,
          signal: uploadOpts.signal,
          onProgress: uploadOpts.onProgress,
        });
        log(`upload ok    (${uploadOpts.filename})`);
      } catch (e) {
        log(`upload ${e instanceof UploadAbortedError ? "abort" : "FAIL "} (${uploadOpts.filename})`);
        throw e;
      }
    },
  };
}

const SCRIPT: CaptureLiveStatus[] = ["preparing", "transcribing", "delivered", "failed"];

function ScriptedBubble() {
  const [status, setStatus] = useState<CaptureLiveStatus>("preparing");
  const model: CaptureBubbleModel = {
    id: "scripted",
    state: status === "failed" ? "failed:deliver" : status === "delivered" ? "delivering" : "preparing",
    counts: COUNTS,
    startedAt: SECONDS_AGO,
    lastActivityAt: SECONDS_AGO,
    liveStatus: status,
    resolution: status === "delivered" ? "delivered" : undefined,
  };
  return (
    <div className="border border-warm-300 rounded-lg p-4 bg-warm-50">
      <div className="mb-2 flex flex-wrap gap-2">
        {SCRIPT.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-2 py-1 rounded text-xs ${status === s ? "bg-primary text-white" : "bg-warm-200 text-warm-700 hover:bg-warm-300"}`}
          >
            {s}
          </button>
        ))}
      </div>
      <CaptureBubbleView model={model} now={HARNESS_NOW} onRetry={announce("retry")} onDiscard={announce("discard")} />
      {status === "delivered" ? (
        <div className="mt-2 text-xs text-warm-500 italic">
          the resolved face is held for {String(RESOLVED_HOLD_MS / 1000)}s in place, then the row leaves and the
          delivered chip stands in history
        </div>
      ) : null}
    </div>
  );
}

const DELIVERED_CAPTURE_WRAPPER = "<capture doc=\"tmp-capture/capture-20260709T1432-ab3f.capture-session.card\" images=\"3\" audio=\"4:10\">\nWalked through the kitchen.\n</capture>";
const DELIVERED_WRAPPERS = [
  DELIVERED_CAPTURE_WRAPPER,
  "<capture doc=\"tmp-capture/capture-20260709T1500-77cd.capture-session.card\" images=\"0\" audio=\"1:20\" partial=\"1\" transcription-failed=\"1\">\nquick note about the leak\n</capture>",
];

const MIXED_DELIVERED_ENTRY: SessionEntry = {
  uuid: "mixed-delivered-message",
  type: "user",
  timestamp: "2026-08-06T12:00:00Z",
  content: [{
    type: "text",
    text: '<chat-app narration="off" prose="on" local-time="Thursday 2026-08-06 07:00 CDT"/>\n' +
      "Keep these with the project.\n\n" +
      DELIVERED_CAPTURE_WRAPPER +
      '\n\n<upload doc="tmp-upload/reference/Batch.upload-batch.card" files="3" bytes="2 KB">\n' +
      "Background material.\n\n3 files uploaded (2 KB).\n</upload>\n\nThen compare the notes.",
  }],
};

/** The banner is driven by props here, so its buttons have nothing to do. */
const noop = () => { /* harness: no transport behind these controls */ };

/** Every face the overlay's failed-upload banner can wear, driven by props. */
const RETRY_FACES: RetryFeedback[] = [
  { phase: "idle" },
  { phase: "retrying", count: 3 },
  { phase: "recovered" },
  { phase: "failed-again", count: 2 },
];

function RetryBanners() {
  return (
    <div className="space-y-3">
      {RETRY_FACES.map((feedback) => (
        <div key={feedback.phase}>
          <div className="text-xs font-mono text-warm-500">{feedback.phase}</div>
          <div className="bg-gray-900 text-white rounded-lg overflow-hidden">
            <CaptureControls
              sessionId="fake" recording={false} finalizing={false} hasContent
              pendingUploads={feedback.phase === "retrying" ? 3 : 0}
              photosFailed={2} audioFailed={1} filesFailed={0}
              retryFeedback={feedback}
              onDone={noop} onCancel={noop} onToggleRecording={noop}
              onRetryFailed={noop} onSkipPending={noop}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function OverlayDemo() {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [seconds, setSeconds] = useState(4);
  const [fail, setFail] = useState(false);
  useEffect(() => {
    fakeBehavior.seconds = seconds;
    fakeBehavior.fail = fail;
  }, [seconds, fail]);
  const appendLog = useCallback((line: string) => setLog((prev) => [...prev.slice(-9), line]), []);
  // Stable identity across renders — the capture hooks memoize on it, and a
  // fresh api object each render would re-enqueue work.
  const api = useMemo(() => makeFakeApi({ log: appendLog }), [appendLog]);
  return (
    <div className="border border-warm-300 rounded-lg p-4 bg-warm-50">
      <p className="text-xs text-warm-600 mb-2">
        Uploads are serialized, so with a slow transport you can add several files
        from the paperclip and watch them go one at a time with a live percentage.
        Press Done mid-flight for the &ldquo;waiting for N uploads / Skip them&rdquo; path.
      </p>
      <div className="flex flex-wrap items-center gap-3 mb-2 text-sm text-warm-700">
        <label className="flex items-center gap-1.5">
          seconds per upload
          <input
            type="number" min={0} max={60} value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
            className="w-16 px-1.5 py-0.5 rounded border border-warm-300"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} />
          fail every upload
        </label>
      </div>
      <button onClick={() => setOpen(true)} className="px-3 py-1.5 rounded bg-primary text-white text-sm hover:bg-primary-dark">
        Open capture overlay
      </button>
      <pre className="mt-2 text-xs text-warm-600 whitespace-pre-wrap">{log.join("\n") || "(fake capture-api calls appear here)"}</pre>
      {open ? (
        <CaptureApiProvider value={api}>
          <CaptureOverlay targetSessionId="dev-chat" onExit={() => setOpen(false)} />
        </CaptureApiProvider>
      ) : null}
    </div>
  );
}

export function CaptureModeHarness() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-warm-50 to-warm-200 p-6 space-y-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <section>
          <h2 className="text-sm font-semibold text-warm-700 mb-2">Pending capture bubble — every caption</h2>
          <div className="space-y-3 bg-gradient-to-b from-warm-50 to-warm-100 border border-warm-300 rounded-lg p-4">
            {BUBBLE_STATES.map(({ label, model }) => (
              <div key={label}>
                <div className="text-xs font-mono text-warm-500">{label}</div>
                <CaptureBubbleView model={model} now={HARNESS_NOW} onRetry={announce("retry")} onDiscard={announce("discard")} />
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-warm-700 mb-2">Failed-upload banner — every retry face</h2>
          <RetryBanners />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-warm-700 mb-2">Scripted capture-status transitions</h2>
          <ScriptedBubble />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-warm-700 mb-2">Delivered capture chip (in transcript)</h2>
          <div className="space-y-2 bg-gradient-to-b from-warm-50 to-warm-100 border border-warm-300 rounded-lg p-4">
            {DELIVERED_WRAPPERS.map((wrapper, i) => {
              const model = parseCaptureWrapper(wrapper);
              return model ? (
                <div key={i} className="flex justify-end">
                  <div className="rounded-l-2xl bg-info text-white px-3 py-2 max-w-sm">
                    <CaptureChip model={model} />
                  </div>
                </div>
              ) : null;
            })}
          </div>
          <div className="mt-3 bg-gradient-to-b from-warm-50 to-warm-100 border border-warm-300 rounded-lg p-4">
            <div className="mb-2 text-xs font-mono text-warm-500">
              snapshot + text + capture + upload + text
            </div>
            <UserMessage entries={[MIXED_DELIVERED_ENTRY]} />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-warm-700 mb-2">Capture overlay (fake api, no device)</h2>
          <OverlayDemo />
        </section>
      </div>
    </div>
  );
}
