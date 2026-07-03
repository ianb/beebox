/**
 * Public field types for personality cards plus the voice-model enum.
 * Kept in a leaf module (no import back to personality.tsx) so the
 * schema and the section emitters can share `PersonalityFields` without
 * a value import cycle.
 */

import type { z } from "zod";
import type {
  ConfidenceLevel,
  BeliefSource,
  ExperimentStatus,
} from "./guide.js";

type ConfidenceLevelType = z.infer<typeof ConfidenceLevel>;
type BeliefSourceType = z.infer<typeof BeliefSource>;
type ExperimentStatusType = z.infer<typeof ExperimentStatus>;

export const VOICE_MODELS = [
  "alloy", "ash", "ballad", "cedar", "coral", "echo",
  "fable", "marin", "onyx", "nova", "sage", "shimmer", "verse",
] as const;
export type VoiceModel = typeof VOICE_MODELS[number];

/**
 * A boxholder, resolved from a `people/*.person.card` with `boxholder: true`.
 * `name` is the person's full name; `called` is their first alias (the
 * nickname the boxholder goes by), if any. This is the single source of
 * truth for who the box serves — the personality card no longer embeds it.
 */
export interface Boxholder {
  name: string;
  called?: string;
}

export interface PersonalityFields {
  type: "personality";
  version: string;
  "goes-by"?: string;
  role?: string;
  boxholder?: {
    relationships?: Array<{
      text: string;
      confidence?: ConfidenceLevelType;
      source?: BeliefSourceType;
      ref?: string;
    }>;
  };
  "speaking-voice"?: {
    model?: VoiceModel;
    instructions?: string[];
  };
  tone?: Array<{
    text: string;
    confidence?: ConfidenceLevelType;
    source?: BeliefSourceType;
    ref?: string;
  }>;
  traits?: Array<{
    text: string;
    confidence?: ConfidenceLevelType;
    source?: BeliefSourceType;
    ref?: string;
  }>;
  unresolved?: string[];
  experiments?: Array<{
    id: string;
    status?: ExperimentStatusType;
    "created-at"?: string;
    "updated-at"?: string;
    hypothesis?: string;
    approach?: string;
    observations?: Array<{ text: string; ref?: string; date?: string }>;
    conclusion?: string;
  }>;
  "context-notes"?: Array<{
    text: string;
    duration?: "ongoing" | "temporary" | "past";
    "added-at"?: string;
  }>;
  body: string;
}
