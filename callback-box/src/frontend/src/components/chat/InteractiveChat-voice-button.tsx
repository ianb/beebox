/**
 * The composer's trailing voice button — toggles recording on/off and resumes
 * after a TTS-induced pause, swapping its icon to reflect the current voice
 * state. Shared by the desktop and mobile button bars (InteractiveChat-composer).
 */

import { MicrophoneIcon } from "./icons";
import { unlockAudioContext } from "../../lib/audio/context";
import { NarrationMicIcon } from "./InteractiveChat-controls";
import type { TranscriptionHandle } from "./InteractiveChat-composer";

const CIRCLE_BTN = "flex items-center justify-center w-14 h-14 rounded-full flex-shrink-0";

export function VoiceToggleButton({
  voicePaused, isTranscribing, narrationEnabled, transcription, onStopDictation, setInput, clearDraft, onUnpause, onVoice,
}: {
  voicePaused: boolean;
  isTranscribing: boolean;
  narrationEnabled: boolean;
  transcription: TranscriptionHandle;
  onStopDictation: () => void;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  clearDraft: () => void;
  onUnpause: () => void;
  onVoice: () => void;
}) {
  return (
    <button
      id="cb-composer-mic"
      // Four states, one address: the description tracks the same four the
      // `title` below does, so a scan reports what the mic does *now* rather
      // than a static catalogue entry.
      data-cb-does={
        voicePaused
          ? "resumes dictation — recording is paused while the agent speaks; tap to stop the speech and pick the mic back up"
          : isTranscribing
            ? "stops recording and leaves the transcript in the composer to edit"
            : narrationEnabled
              // Narration is the *quiet* mode, not a read-aloud one: the
              // overlay (core/chat/session/prompts.ts NARRATION_OVERLAY)
              // suspends "voice in implies voice out" and defaults the agent's
              // turn to an <ack> or a <callout>.
              ? "starts dictation in narration mode — for talking at length; the agent mostly stays quiet and takes notes rather than answering aloud, unless you ask it to speak; tap again to stop"
              : "starts dictation — speak, then tap again to stop and edit before sending"
      }
      onClick={() => {
        if (voicePaused) {
          onUnpause();
        } else if (isTranscribing) {
          // Stop recording, preserve transcript into input for editing. It's
          // now editable typed text, not voice — drop the dictation draft so
          // it can't resurface later as a phantom "Recovered dictation".
          onStopDictation();
          const text = transcription.transcript;
          transcription.cancel();
          if (text) setInput((existing) => (existing ? existing + " " + text : text));
          clearDraft();
        } else {
          unlockAudioContext();
          onVoice();
        }
      }}
      className={`${CIRCLE_BTN} ${voicePaused ? "relative bg-primary/50 text-white animate-pulse" : isTranscribing ? "bg-danger text-white hover:bg-danger-dark active:opacity-80" : "bg-primary text-white hover:bg-primary-dark active:opacity-80"}`}
      title={voicePaused ? "Resume recording (stops speech)" : isTranscribing ? "Stop recording" : narrationEnabled ? "Voice input (narration mode)" : "Voice input"}
    >
      {voicePaused ? (
        // Mic (the action: tap to get the mic back) with a pause badge (the
        // state: it's paused while speech plays) — not a bare pause glyph,
        // which reads as "press to pause".
        <>
          <MicrophoneIcon className="w-7 h-7" />
          <span className="absolute bottom-0.5 right-0.5 flex items-center justify-center w-5 h-5 rounded-full bg-white text-primary">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <rect x="7" y="5" width="3.5" height="14" rx="1" />
              <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
            </svg>
          </span>
        </>
      ) : isTranscribing ? (
        <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      ) : narrationEnabled ? (
        <NarrationMicIcon className="w-7 h-7" />
      ) : (
        <MicrophoneIcon className="w-7 h-7" />
      )}
    </button>
  );
}
