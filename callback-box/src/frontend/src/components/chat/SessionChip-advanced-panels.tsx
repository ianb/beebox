/**
 * The session chip's "Advanced" sub-panel — split out of its host file to
 * keep that under the 300-line cap (the host was `ChatMenu` until the app
 * bar's `SessionChip` replaced it, docs/plans/top-nav-ia.md Track C2). Debug toggles + process controls only; Model,
 * Voice settings, and Narration mode moved to the voice chip's own panels
 * (`VoiceChip-panels.tsx`) in chunk 3 of docs/plans/chat-header-chips.md.
 */

import { MenuItem, MenuDivider } from "../ui/dropdown-menu-item";

/**
 * "Advanced" sub-panel: debug toggles and process controls + status footer.
 */
export function AdvancedPanel({
  onBack,
  debugView,
  onToggleDebugView,
  showDebugLog,
  onToggleDebugLog,
  onCompactSession,
  busy,
  onRestartProcess,
  onStopProcess,
  running,
  sessionId,
}: {
  onBack: () => void;
  debugView: boolean;
  onToggleDebugView: () => void;
  showDebugLog: boolean;
  onToggleDebugLog: () => void;
  onCompactSession: () => void;
  busy: boolean;
  onRestartProcess: () => void;
  onStopProcess: () => void;
  running: boolean;
  sessionId: string | null;
}) {
  return (
    <>
      <MenuItem onClick={onBack} keepOpen>
        <span className="text-warm-500">‹ Advanced</span>
      </MenuItem>
      <MenuDivider />
      <MenuItem onClick={onToggleDebugView}>{debugView ? "✓ " : "  "}Debug View</MenuItem>
      <span className="sm:hidden">
        <MenuItem onClick={onToggleDebugLog}>{showDebugLog ? "✓ " : "  "}Debug Log</MenuItem>
      </span>
      <MenuDivider />
      <MenuItem onClick={onCompactSession} disabled={busy}>Run /compact</MenuItem>
      <MenuItem onClick={onRestartProcess} disabled={!running}>Restart Subprocess</MenuItem>
      <MenuItem onClick={onStopProcess} disabled={!running}>Stop Process</MenuItem>
      <MenuDivider />
      <div className="px-3 py-1.5 text-xs text-warm-500">
        <div>Session: {sessionId ? sessionId.slice(0, 12) + "..." : "none"}</div>
        <div>Process: {running ? (busy ? "busy" : "idle") : "stopped"}</div>
      </div>
    </>
  );
}
