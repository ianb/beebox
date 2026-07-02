/**
 * Personality card schema — agent identity, role, tone, and boxholder knowledge.
 *
 * A personality card captures who the agent is and who it works for.
 * It lives at `config/main.personality.card` (one per box).
 *
 * The card's markdown body is the compiled "description" paragraph —
 * the prose that captures the overall vibe. Job-processing agents see
 * this body plus a stripped-down summary of tone/traits derived from
 * the structured frontmatter.
 */

import { z } from "zod";
import { body, cardSchema, type CardSchema } from "../cards/index.js";
import {
  ConfidenceLevel,
  BeliefSource,
  ExperimentStatus,
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
import { VOICE_MODELS, type VoiceModel, type PersonalityFields } from "./personality-fields.js";
export { createInitialPersonalityTemplate } from "./personality-template.js";
export { VOICE_MODELS, type VoiceModel, type PersonalityFields } from "./personality-fields.js";

const RelationshipEntry = z.object({
  text: z.string(),
  confidence: ConfidenceLevel.default("confirmed"),
  source: BeliefSource.default("user-stated"),
  ref: z.string().optional(),
});

const BoxholderEntry = z.object({
  ref: z.string().optional(),
  "full-name": z.string().optional(),
  called: z.string().optional(),
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
  confidence: ConfidenceLevel.default("medium"),
  source: BeliefSource.default("inferred"),
  ref: z.string().optional(),
});

const TraitEntry = z.object({
  text: z.string(),
  confidence: ConfidenceLevel.default("medium"),
  source: BeliefSource.default("inferred"),
  ref: z.string().optional(),
});

const ObservationEntry = z.object({
  text: z.string(),
  ref: z.string().optional(),
  date: z.string().optional(),
});

const ExperimentEntry = z.object({
  id: z.string(),
  status: ExperimentStatus.default("proposed"),
  "created-at": z.string().optional(),
  "updated-at": z.string().optional(),
  hypothesis: z.string().optional(),
  approach: z.string().optional(),
  observations: z.array(ObservationEntry).optional(),
  conclusion: z.string().optional(),
});

const ContextNote = z.object({
  text: z.string(),
  duration: z.enum(["ongoing", "temporary", "past"]).default("ongoing"),
  "added-at": z.string().optional(),
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
 * instructions, and boxholder relationship info.
 */
export function compilePersonality(fields: PersonalityFields): string {
  const lines: string[] = [];
  lines.push("## Personality");
  lines.push("");
  lines.push("<!-- Source: config/main.personality.card — edit this file to change personality -->");
  lines.push("");

  appendIdentity(lines, fields);
  appendBoxholder(lines, fields);
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
