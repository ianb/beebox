/**
 * VoiceNoteButton — pill-shaped toggle for starting/stopping voice
 * transcription. Shows a mic icon when idle, a red pulsing dot + "Stop"
 * when recording. Paired status text ("Connecting…", "Finishing…") can
 * be rendered alongside by the caller using <Text size="xs" tone="muted">.
 */

type VoiceNoteState = "idle" | "connecting" | "recording" | "finalizing";

interface VoiceNoteButtonProps {
  state: VoiceNoteState;
  onToggle: () => void;
  disabled?: boolean;
}

export function VoiceNoteButton({ state, onToggle, disabled }: VoiceNoteButtonProps) {
  const isRecording = state === "recording";
  const busy = state === "connecting" || state === "finalizing";

  const base = "flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors";
  const toneClass = isRecording
    ? "bg-danger-100 text-danger-dark hover:bg-danger-100"
    : "bg-warm-100 text-warm-700 hover:bg-warm-200";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled || busy}
      className={`${base} ${toneClass}`}
    >
      {isRecording ? (
        <>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger-light opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
          </span>
          Stop
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
              clipRule="evenodd"
            />
          </svg>
          Voice Note
        </>
      )}
    </button>
  );
}
