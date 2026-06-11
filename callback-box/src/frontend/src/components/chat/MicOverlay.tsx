import { VolumeIndicator } from "../VolumeIndicator";
import { KeywordHint } from "./KeywordHint";

/**
 * Floating status cluster above the composer while the mic is live: live
 * volume bars stacked over the rotating keyword hint, mirroring
 * memory-atlas's placement above its mic control. The parent supplies a
 * `relative` container.
 */
export function MicOverlay({ hasText }: { hasText: boolean }) {
  return (
    <div className="absolute bottom-full left-0 mb-1 flex flex-col items-start gap-1 pointer-events-none">
      <VolumeIndicator />
      <KeywordHint hasText={hasText} />
    </div>
  );
}
