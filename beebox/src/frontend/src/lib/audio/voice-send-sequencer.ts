/**
 * FIFO ordering for voice sends (`docs/plans/resilient-voice-recording.md`,
 * Track 4). Each voice segment reserves a slot the moment it ends; its
 * dispatch then waits for every earlier slot to be released. HQ waits still
 * run concurrently — only the dispatches are ordered — so segment 2's quick
 * HQ result cannot land before segment 1's retried one.
 *
 * A slot must always be released (dispatched, fell back, or gave up), or
 * every later voice send waits forever: callers release in a `finally`.
 */

export interface VoiceSendSlot {
  /** Resolves once every earlier slot has been released. */
  turn: () => Promise<void>;
  /** Let the next slot proceed. Idempotent. */
  release: () => void;
}

export interface VoiceSendSequencer {
  reserve: () => VoiceSendSlot;
}

export function createVoiceSendSequencer(): VoiceSendSequencer {
  let tail: Promise<void> = Promise.resolve();
  return {
    reserve: () => {
      const prior = tail;
      let release = (): void => {};
      const mine = new Promise<void>((resolve) => {
        release = resolve;
      });
      tail = prior.then(() => mine);
      return { turn: () => prior, release: () => release() };
    },
  };
}

/** The app's one sequencer: voice sends from this tab dispatch in segment order. */
export const voiceSendSequencer = createVoiceSendSequencer();
