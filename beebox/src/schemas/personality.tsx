/**
 * Personality card schema — agent identity, role, tone, and boxholder knowledge.
 *
 * A personality card captures who the agent is and who it works for.
 * It lives at `_config/main.personality.card` (one per box).
 *
 * The card's markdown body is the compiled "description" paragraph —
 * the prose that captures the overall vibe. Job-processing agents see
 * this body plus a stripped-down summary of tone/traits derived from
 * the structured frontmatter.
 */

import { z } from "zod";
import { body, cardSchema, type CardSchema } from "../cards/index.js";
import {
  ConfidenceLevelSchema,
  BeliefSourceSchema,
  ExperimentStatusSchema,
} from "./guide.js";
import {
  appendBoxholder,
  appendContext,
  appendDescription,
  appendExperiments,
  appendIdentity,
  appendSpeakingVoice,
  appendTone,
} from "./personality-compile.js";
import { PERSONALITY_INSTRUCTIONS } from "./personality-instructions.js";
import { VOICE_MODELS, type VoiceModel, type PersonalityFields, type Boxholder } from "./personality-fields.js";

export { createInitialPersonalityTemplate } from "./personality-template.js";
export { VOICE_MODELS, type VoiceModel, type PersonalityFields, type Boxholder } from "./personality-fields.js";

const RelationshipEntry = z.object({
  text: z.string(),
  confidence: ConfidenceLevelSchema.default("confirmed"),
  source: BeliefSourceSchema.default("user-stated"),
  ref: z.string().optional(),
});

const BoxholderEntry = z.object({
  relationships: z.array(RelationshipEntry).optional(),
});

const SpeakingVoiceEntry = z.object({
  model: z.enum(VOICE_MODELS).optional(),
  instructions: z.array(z.string()).optional(),
});

export const CompiledSpeakingVoiceSchema = z.object({
  model: z.enum(VOICE_MODELS).optional(),
  instructions: z.array(z.string()),
});

const ToneInstruction = z.object({
  text: z.string(),
  confidence: ConfidenceLevelSchema.default("medium"),
  source: BeliefSourceSchema.default("inferred"),
  ref: z.string().optional(),
});

const TraitEntry = z.object({
  text: z.string(),
  confidence: ConfidenceLevelSchema.default("medium"),
  source: BeliefSourceSchema.default("inferred"),
  ref: z.string().optional(),
});

const ObservationEntry = z.object({
  text: z.string(),
  ref: z.string().optional(),
  date: z.string().optional(),
});

const ExperimentEntry = z.object({
  id: z.string(),
  status: ExperimentStatusSchema.default("proposed"),
  hypothesis: z.string().optional(),
  approach: z.string().optional(),
  observations: z.array(ObservationEntry).optional(),
  conclusion: z.string().optional(),
});

const ContextNote = z.object({
  text: z.string(),
  duration: z.enum(["ongoing", "temporary", "past"]).default("ongoing"),
});

export const PersonalitySchema: CardSchema = cardSchema("personality", {
  description: "The assistant's voice and communication style — tone, traits, and boxholder relationship; compiled into every agent's context",
  category: "authored",
  fields: {
    version: z.string().default("1.0.0"),
    "goes-by": z.string().optional(),
    role: z.string().optional(),
    boxholder: BoxholderEntry.optional(),
    "speaking-voice": SpeakingVoiceEntry.optional(),
    tone: z.array(ToneInstruction).optional(),
    traits: z.array(TraitEntry).optional(),
    unresolved: z.array(z.string()).optional(),
    experiments: z.array(ExperimentEntry).optional(),
    "context-notes": z.array(ContextNote).optional(),
    body: body(z.string()),
  },
  instructions: PERSONALITY_INSTRUCTIONS,
});

/**
 * Compile a personality fields object into markdown for the agent
 * guide. The "core instructions" compilation — what every agent sees.
 * Uses the body paragraph (not bullet-point traits), confident tone
 * instructions, and boxholder relationship info. `boxholders` are
 * resolved from `people/*.person.card` (`boxholder: true`) by the caller
 * — the identity source of truth; the personality card only carries the
 * relational notes.
 */
export function compilePersonality(fields: PersonalityFields, { boxholders }: { boxholders: Boxholder[] }): string {
  const lines: string[] = [];
  lines.push("## Personality");
  lines.push("");
  lines.push("<!-- Source: _config/main.personality.card — edit this file to change personality -->");
  lines.push("");

  appendIdentity(lines, fields);
  appendBoxholder(lines, { fields, boxholders });
  lines.push("");
  appendDescription(lines, fields);
  appendTone(lines, fields);
  appendSpeakingVoice(lines, fields);
  appendExperiments(lines, fields);
  appendContext(lines, fields);

  return lines.join("\n");
}

export interface CompiledSpeakingVoice {
  model: VoiceModel | undefined;
  instructions: string[];
}

/**
 * Extract speaking voice config for the Electron app.
 */
export function compileSpeakingVoice(fields: PersonalityFields): CompiledSpeakingVoice {
  const sv = fields["speaking-voice"];
  return {
    model: sv?.model,
    instructions: sv?.instructions ?? [],
  };
}
