/**
 * Accessible-name builder for the voice chip trigger — a pure function so the
 * mute × narration × hqInFlight state space is doctestable without React
 * (see test/frontend/voice-chip-face.doctest.md).
 */

export interface VoiceChipState {
  muted: boolean;
  narrationEnabled: boolean;
  hqInFlight: boolean;
}

/**
 * "Voice" plus a comma-joined list of active states, e.g.
 * "Voice — muted, narration on". No suffix when every state is off.
 */
export function voiceChipLabel({ muted, narrationEnabled, hqInFlight }: VoiceChipState): string {
  const parts: string[] = [];
  if (muted) parts.push("muted");
  if (narrationEnabled) parts.push("narration on");
  if (hqInFlight) parts.push("transcribing");
  return parts.length === 0 ? "Voice" : `Voice — ${parts.join(", ")}`;
}
