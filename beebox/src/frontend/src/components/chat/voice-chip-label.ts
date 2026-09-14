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
 * "Voice" plus what the two participants are doing, in words.
 *
 * The glyphs say it by weight and shape; the name says it outright, because the
 * two facts the chip carries are a relationship ("you are holding the floor")
 * and a channel ("it answers in text"), and neither survives being read as a
 * list of toggle names. A screen reader hears the sentence, not "narration on".
 */
export function voiceChipLabel({ muted, narrationEnabled, hqInFlight }: VoiceChipState): string {
  const floor = narrationEnabled ? "you are narrating, it listens" : "taking turns";
  const channel = muted ? "answers in text" : "answers aloud";
  const parts = [floor, channel];
  if (hqInFlight) parts.push("transcribing");
  return `Voice — ${parts.join(", ")}`;
}
