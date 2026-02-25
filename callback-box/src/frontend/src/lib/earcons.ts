/**
 * Simple earcon (UI sound) player, adapted from memory-atlas.
 * Audio files live in public/earcons/.
 */

class EarCon {
  name: string;
  filename: string;
  volume: number;
  private audioElement?: HTMLAudioElement;

  constructor({ name, filename, volume }: { name: string; filename: string; volume: number }) {
    this.name = name;
    this.filename = filename;
    this.volume = volume;
  }

  play() {
    const url = `/earcons/${this.filename}`;
    if (!this.audioElement) {
      this.audioElement = new Audio(url);
    }
    try {
      this.audioElement.pause();
    } catch (_e) {
      // ignore
    }
    this.audioElement.src = url;
    this.audioElement.volume = this.volume;
    this.audioElement.play().catch((e) => {
      console.info("[earcon] Error playing", this.name, e);
    });
    const audio = this.audioElement;
    const finished = new Promise<void>((resolve) => {
      const callback = () => {
        resolve();
        audio.removeEventListener("ended", callback);
      };
      audio.addEventListener("ended", callback);
    });
    return { finished };
  }

  repeatPlay(period: number, limit = 5000) {
    this.play();
    const start = Date.now();
    const id = setInterval(() => {
      if (Date.now() - start > limit) {
        clearInterval(id);
        return;
      }
      this.play();
    }, period);
    return () => {
      clearInterval(id);
    };
  }
}

export const sendSound = new EarCon({ name: "send", filename: "beeprising.wav", volume: 0.3 });
export const tick = new EarCon({ name: "tick", filename: "tick2.wav", volume: 0.6 });
export const recordingStart = new EarCon({ name: "recordingStart", filename: "recording-start.mp3", volume: 0.7 });
