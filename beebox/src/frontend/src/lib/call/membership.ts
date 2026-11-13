/** Small pieces of the call engine (`engine.ts`): the mic, and leaving a membership explicitly. */

import { trpcClient } from "../trpc/client";

const MIC: MediaStreamConstraints = { audio: { echoCancellation: true, noiseSuppression: true } };

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The mic track, or null when denied; any other failure is the same to the person: no mic. */
export async function openMic(): Promise<MediaStreamTrack | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(MIC);
    return stream.getAudioTracks()[0] ?? null;
  } catch (e) {
    console.warn(`[call] microphone unavailable: ${errorText(e)}`);
    return null;
  }
}

/** Leave by mutation as well as by ending the subscription: tRPC can drop an early stop. Never rejects. */
export async function leaveMembership(member: { sessionId: string; callId: string; peerId: string }): Promise<void> {
  try {
    await trpcClient.chatCall.leave.mutate(member);
  } catch (e) {
    console.warn(`[call] leave failed: ${errorText(e)}`);
  }
}
