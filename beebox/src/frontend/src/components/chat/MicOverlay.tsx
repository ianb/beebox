import { VolumeIndicator } from "./VolumeIndicator";
import { KeywordHint } from "./KeywordHint";

/**
 * Floating status cluster above the composer's record/stop button while the
 * mic is live: live volume bars stacked over the rotating keyword hint,
 * mirroring memory-atlas's placement above its mic control. Right-anchored
 * so it rides the voice button, not the chat text. The parent supplies a
 * `relative` container.
 *
 * This is the home of ALL mic status. Faces, in priority order:
 * - `degraded` (the microphone was lost and is being re-acquired): the bars
 *   turn amber and a "recovering…" chip replaces the keyword hint.
 * - `livePaused` (recording and staging to the box, but no live text — the
 *   transcription socket is down or unavailable): the chip says so, and that
 *   spoken commands can't be heard; the manual stop/send buttons still work.
 *   The bars stay green: the recording itself is fine.
 */
export function MicOverlay({ hasText, degraded, livePaused }: { hasText: boolean; degraded: boolean; livePaused: boolean }) {
  return (
    <div className="absolute bottom-full right-0 mb-1 flex flex-col items-end gap-1 pointer-events-none">
      <VolumeIndicator degraded={degraded} />
      {degraded ? (
        <div className="text-xs text-warning-dark bg-warning-50/90 px-1.5 py-0.5 rounded whitespace-nowrap">
          recovering…
        </div>
      ) : livePaused ? (
        <div role="status" className="text-xs text-warning-dark bg-warning-50/90 px-1.5 py-0.5 rounded text-right">
          <div className="whitespace-nowrap">Recording · live text paused</div>
          <div className="whitespace-nowrap text-warm-700">spoken commands unavailable</div>
        </div>
      ) : (
        <KeywordHint hasText={hasText} />
      )}
    </div>
  );
}
