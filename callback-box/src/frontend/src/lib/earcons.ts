/**
 * Simple earcon (UI sound) player, adapted from memory-atlas.
 * Audio files live in public/earcons/.
 * Uses shared pre-unlocked Audio element for iOS Safari compatibility.
 */

import { playAudioUrl } from "./audio-context";

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
    const url = `/earcons/${this.filename}`;
    const result = playAudioUrl(url, this.volume);
    return { started: result.finished, finished: result.finished, stop: result.stop };
  }

  repeatPlay(period: number, limit = 5000) {
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
// Source: https://freesound.org/people/SoapBoxRocket/sounds/846141/
export const alarm = new EarCon({ name: "alarm", filename: "krell-alarm-7.wav", volume: 0.8 });
