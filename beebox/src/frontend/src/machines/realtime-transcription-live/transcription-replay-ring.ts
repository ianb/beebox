/**
 * The replay ring for the live transcription socket
 * (`docs/plans/resilient-voice-recording.md`, Track 3). It keeps the last
 * `capacity` PCM frames and the point in the frame stream where live
 * forwarding stopped. A (re)connected socket is sent the frames since that
 * point, capped at the ring; anything older exists only in voice staging.
 *
 * The gap starts at frame 0, so the first connect of a segment replays what
 * was said while the socket was opening.
 */
export class ReplayRing {
  private readonly capacity: number;
  private readonly frames: ArrayBuffer[] = [];
  private seen = 0;
  private gapStart = 0;

  constructor(opts: { capacity: number }) {
    this.capacity = opts.capacity;
  }

  push(frame: ArrayBuffer): void {
    this.frames.push(frame);
    if (this.frames.length > this.capacity) this.frames.shift();
    this.seen += 1;
  }

  /** Live forwarding stopped `padFrames` before now (a drop's detection latency). */
  markGap(opts: { padFrames: number }): void {
    this.gapStart = Math.max(0, this.seen - opts.padFrames);
  }

  /** The frames since the gap, oldest first, at most the whole ring. */
  sinceGap(): ArrayBuffer[] {
    const wanted = Math.min(this.seen - this.gapStart, this.frames.length);
    return wanted > 0 ? this.frames.slice(this.frames.length - wanted) : [];
  }
}
