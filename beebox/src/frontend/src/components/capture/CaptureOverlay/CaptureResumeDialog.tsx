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
import { friendlyDate } from "../../ui/FriendlyDate";
import { ModalCard } from "../../ui/ModalCard";
import { summarizeCaptureContents } from "../../chat/capture-message";

/**
 * A native modal with no `onCancel`: Escape does nothing. The only ways out
 * are the three choices.
 */
export function CaptureResumeDialog({ capture, busy, onResume, onSubmit, onDiscard, includeControlIds }: {
  capture: ResumableCaptureView;
  busy: boolean;
  onResume: () => void;
  onSubmit: () => void;
  onDiscard: () => void;
  includeControlIds?: boolean;
}) {
  const hasControlIds = includeControlIds !== false;
  return (
    <ModalCard open tone="dark" labelledBy="capture-resume-title">
      <h2 id="capture-resume-title" className="text-lg font-semibold">Unfinished capture</h2>
      <p className="mt-2 text-sm text-gray-300">
        A capture from {friendlyDate(capture.startedAt)} was never submitted — it still has {summarizeCaptureContents(capture.counts)}.
        Pick up where you left off, submit it now, or throw it away.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <button id={hasControlIds ? "bbx-capture-resume" : undefined} onClick={onResume} disabled={busy}
          className="w-full rounded-lg bg-success py-2.5 text-sm font-medium disabled:opacity-40 active:bg-success">
          Resume capturing
        </button>
        <button id={hasControlIds ? "bbx-capture-resume-submit" : undefined} onClick={onSubmit} disabled={busy} aria-busy={busy}
          className="w-full rounded-lg bg-gray-700 py-2.5 text-sm font-medium disabled:opacity-40 active:bg-gray-600">
          Submit now
        </button>
        <button id={hasControlIds ? "bbx-capture-resume-discard" : undefined} onClick={onDiscard} disabled={busy} aria-busy={busy}
          className="w-full rounded-lg py-2.5 text-sm font-medium text-danger-light disabled:opacity-40 active:bg-gray-800">
          Discard
        </button>
      </div>
    </ModalCard>
  );
}
