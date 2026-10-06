/**
 * Simple earcon (UI sound) player, adapted from memory-atlas.
 * Audio files live in public/earcons/.
 * Uses shared pre-unlocked Audio element for iOS Safari compatibility.
 */

import { withBase } from "../../api";
import { playAudioUrl } from "./context";

class EarCon {
  name: string;
  filename: string;
  volume: number;

  constructor({ name, filename, volume }: { name: string; filename: string; volume: number }) {
    this.name = name;
    this.filename = filename;
    this.volume = volume;
  }

  play() {
    const url = withBase(`/earcons/${this.filename}`);
    const result = playAudioUrl(url, { volume: this.volume });
    return { started: result.finished, finished: result.finished, stop: result.stop };
  }

  repeatPlay(period: number, limit?: number) {
    limit = limit ?? 5000;
    const handles: Array<{ stop: () => void }> = [];
    handles.push(this.play());
    const start = Date.now();
    const id = setInterval(() => {
      if (Date.now() - start > limit) {
        clearInterval(id);
        return;
      }
      handles.push(this.play());
    }, period);
    return () => {
      clearInterval(id);
      for (const h of handles) h.stop();
    };
  }
}

export const sendSound = new EarCon({ name: "send", filename: "beeprising.wav", volume: 0.3 });
export const tick = new EarCon({ name: "tick", filename: "tick2.wav", volume: 0.6 });
export const stillListening = new EarCon({ name: "stillListening", filename: "book-close.wav", volume: 0.3 });
export const recordingStart = new EarCon({ name: "recordingStart", filename: "recording-start.mp3", volume: 0.7 });
export const recordingStop = new EarCon({ name: "recordingStop", filename: "recording-stop.mp3", volume: 0.7 });
// Distinct descending error cue for when recording fails to start. See SOURCES.md.
export const recordingError = new EarCon({ name: "recordingError", filename: "recording-error.wav", volume: 0.7 });
// Source: https://freesound.org/people/SoapBoxRocket/sounds/846141/ — see SOURCES.md
export const alarm = new EarCon({ name: "alarm", filename: "krell-alarm-7.wav", volume: 0.8 });
// Mid-session recording feedback, split by consequence. micLost fires when
// the microphone is gone: no audio is recorded, and the segment ends unless it
// returns, so it is the one urgent cue. liveTextPaused fires when live text
// has been down a couple of seconds while the recording continues — only
// spoken keywords are lost, so it is quiet, and liveTextResumed (its mirror)
// marks the return. recordingResumed reuses the go-live cue for "the mic is
// back". mic-lost.wav and the live-text pair are authored here (SOURCES.md);
// iOS plays the same mic-lost.wav for an audio-session interruption.
export const micLost = new EarCon({ name: "micLost", filename: "mic-lost.wav", volume: 0.5 });
export const recordingResumed = new EarCon({ name: "recordingResumed", filename: "recording-start.mp3", volume: 0.7 });
export const liveTextPaused = new EarCon({ name: "liveTextPaused", filename: "live-text-paused.wav", volume: 0.3 });
export const liveTextResumed = new EarCon({ name: "liveTextResumed", filename: "live-text-resumed.wav", volume: 0.3 });
