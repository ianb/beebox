/**
 * Recording one member's own microphone while a call is transcribed
 * (docs/plans/chat-calls.md, Track F). The recording is an ordinary voice
 * staging session, registered with the call before capture starts so the
 * box's fold knows to wait for it even if this tab closes and the staging
 * queue uploads it later. It borrows the call's mic stream and never stops or
 * re-acquires it; if the track ends, the recording finalizes.
 */

import { MicCapture } from "../audio/mic-capture/core";
import { startStagedRecording } from "../audio/voice-stager";
import { enqueueCreate, enqueueChunk, enqueueFinalize, enqueueDiscard } from "../audio/voice-staging-queue/queue";
import { trpcClient } from "../trpc/client";

const VOICE_STAGING_SINK = { enqueueCreate, enqueueChunk, enqueueFinalize, enqueueDiscard };
/** The worklet's 16 kHz mono s16le: 32 bytes per millisecond. */
const PCM_BYTES_PER_MS = 32;

export interface CallRecordingOptions {
  /** The call engine's own mic stream. The recording borrows it: never stops or reacquires its tracks. */
  stream: MediaStream;
  sessionId: string;
  callId: string;
  peerId: string;
  /** Client real clock minus the server's at join; used only to flag skew. */
  clockOffsetMs: number;
}

export interface CallRecording {
  /** Finalize and upload; resolves once the finalize is queued. */
  stop: () => Promise<void>;
}

/** Register a recording with the call, then start capturing. Rejects if registration fails; nothing is recorded then. */
export async function startCallRecording(opts: CallRecordingOptions): Promise<CallRecording> {
  const { stream, sessionId, callId, peerId, clockOffsetMs } = opts;
  const voiceSessionId = crypto.randomUUID();
  await trpcClient.chatCall.registerRecording.mutate({ sessionId, callId, peerId, voiceSessionId, clockOffsetMs });

  const recording = startStagedRecording({ recordingId: voiceSessionId, targetSessionId: sessionId, sink: VOICE_STAGING_SINK });
  let firstAudioAtMs: number | null = null;
  let mic: MicCapture | null = null;
  let stopped = false;
  const stop = (): Promise<void> => {
    if (!stopped) {
      stopped = true;
      mic?.dispose();
      // Always sealed, never discarded: the fold waits for every registered
      // recording, and an empty one transcribes to nothing at once. Real wall
      // clock (`Date.now()`), never the box's shifted clock.
      recording.seal({ emissionId: null, hq: null, call: { callId, firstAudioAtMs: firstAudioAtMs ?? Date.now() } });
    }
    return Promise.resolve();
  };
  mic = new MicCapture(
    {
      onPcm: (samples) => {
        // The first frame arrives once it is full; its audio began one frame earlier.
        firstAudioAtMs ??= Date.now() - Math.round(samples.byteLength / PCM_BYTES_PER_MS);
        recording.push(samples);
      },
      onMicLost: () => void stop(),
      onMicRestored: () => {},
    },
    { borrowed: stream },
  );
  try {
    await mic.start();
  } catch (e) {
    await stop();
    throw e;
  }
  return { stop };
}
