import { VolumeIndicator } from "../VolumeIndicator";
import { KeywordHint } from "./KeywordHint";

/**
 * Floating status cluster above the composer's record/stop button while the
 * mic is live: live volume bars stacked over the rotating keyword hint,
 * mirroring memory-atlas's placement above its mic control. Right-anchored
 * so it rides the voice button, not the chat text. The parent supplies a
 * `relative` container.
 *
 * This is the home of ALL mic status. While the session is degraded
 * (network reconnect or mic re-acquisition in flight) the bars turn amber
 * and a "recovering…" chip replaces the keyword hint — moving bars then
 * mean the mic still hears you (network blip), flat bars mean it doesn't
 * (mic blip).
 */
export function MicOverlay({ hasText, degraded }: { hasText: boolean; degraded: boolean }) {
  return (
    <div className="absolute bottom-full right-0 mb-1 flex flex-col items-end gap-1 pointer-events-none">
      <VolumeIndicator degraded={degraded} />
      {degraded ? (
        <div className="text-xs text-warning-dark bg-warning-50/90 px-1.5 py-0.5 rounded whitespace-nowrap">
          recovering…
        </div>
      ) : (
        <KeywordHint hasText={hasText} />
      )}
    </div>
  );
}
