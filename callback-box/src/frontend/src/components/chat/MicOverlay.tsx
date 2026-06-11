import { VolumeIndicator } from "../VolumeIndicator";
import { KeywordHint } from "./KeywordHint";

/**
 * Floating status cluster above the composer's record/stop button while the
 * mic is live: live volume bars stacked over the rotating keyword hint,
 * mirroring memory-atlas's placement above its mic control. Right-anchored
 * so it rides the voice button, not the chat text. The parent supplies a
 * `relative` container.
 */
export function MicOverlay({ hasText }: { hasText: boolean }) {
  return (
    <div className="absolute bottom-full right-0 mb-1 flex flex-col items-end gap-1 pointer-events-none">
      <VolumeIndicator />
      <KeywordHint hasText={hasText} />
    </div>
  );
}
