/**
 * Temporary probe: speech reached playback while the chat was muted
 * (issues/bugs/2026-11-13-speech-is-synthesized-while-the-chat-is-muted.md).
 * Only the last segment of a reply was requested, so the end-of-reply flush is
 * the suspect. Warns (forwarded to the box's client-debug.log) when any mute
 * signal (the composer machine's, or the stored `chat-muted` flag the toggle
 * writes) is on at the moment playback is commanded, with each signal and the
 * voice state; silent otherwise. Remove with the fix.
 */

import { readStoredFlag } from "../../../../lib/stored-flag";
import { CHAT_MUTED } from "./hooks";

export function probeMutedSpeech({ command, machine }: {
  command: { messageId: string; segments: readonly unknown[]; baseIndex: number };
  /** The composer machine's snapshot when the command ran. */
  machine: { context: { muted: boolean }; value: unknown };
}): void {
  const storedMuted = readStoredFlag(CHAT_MUTED);
  if (!machine.context.muted && !storedMuted) return;
  const detail = {
    messageId: command.messageId, segmentCount: command.segments.length, baseIndex: command.baseIndex,
    machineMuted: machine.context.muted, storedMuted, voiceState: machine.value,
  };
  console.warn(`[speech-mute-probe] playback commanded while muted ${JSON.stringify(detail)}`);
}
