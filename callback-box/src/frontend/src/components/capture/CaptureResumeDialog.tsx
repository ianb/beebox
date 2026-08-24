/**
 * Crash-resume prompt for capture mode (Track 5).
 *
 * Shown over the dark capture shell when an unfinished (`open`, non-empty)
 * staging session is found on entering capture mode. Three choices:
 * - Resume — reopen that session and keep capturing (a new recording is a new
 *   segment; new media numbers above what's already staged).
 * - Submit now — finalize it as-is (a deliberate, non-partial submit).
 * - Discard — throw the staged media away.
 *
 * Under `components/` so it's exempt from restrict-component-classes and can use
 * the reused dark capture palette directly.
 */

import type { ResumableCaptureView } from "./useCaptureResume";

function summarizeContents(counts: ResumableCaptureView["counts"]): string {
  const parts: string[] = [];
  if (counts.audioSegments > 0) parts.push(`${counts.audioSegments} recording${counts.audioSegments > 1 ? "s" : ""}`);
  if (counts.photos > 0) parts.push(`${counts.photos} photo${counts.photos > 1 ? "s" : ""}`);
  if (counts.files > 0) parts.push(`${counts.files} file${counts.files > 1 ? "s" : ""}`);
  return parts.length > 0 ? parts.join(", ") : "some media";
}

export function CaptureResumeDialog({ capture, busy, onResume, onSubmit, onDiscard }: {
  capture: ResumableCaptureView;
  busy: boolean;
  onResume: () => void;
  onSubmit: () => void;
  onDiscard: () => void;
}) {
  const started = new Date(capture.startedAt);
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 px-6" role="dialog" aria-modal="true" aria-label="Resume unfinished capture">
      <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-700 p-6 text-white">
        <h2 className="text-lg font-semibold">Unfinished capture</h2>
        <p className="mt-2 text-sm text-gray-300">
          A capture from {started.toLocaleString()} was never submitted — it still has {summarizeContents(capture.counts)}.
          Pick up where you left off, submit it now, or throw it away.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button id="cb-capture-resume" onClick={onResume} disabled={busy}
            className="w-full rounded-lg bg-success py-2.5 text-sm font-medium disabled:opacity-40 active:bg-success">
            Resume capturing
          </button>
          <button id="cb-capture-resume-submit" onClick={onSubmit} disabled={busy} aria-busy={busy}
            className="w-full rounded-lg bg-gray-700 py-2.5 text-sm font-medium disabled:opacity-40 active:bg-gray-600">
            Submit now
          </button>
          <button id="cb-capture-resume-discard" onClick={onDiscard} disabled={busy} aria-busy={busy}
            className="w-full rounded-lg py-2.5 text-sm font-medium text-danger-light disabled:opacity-40 active:bg-gray-800">
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
