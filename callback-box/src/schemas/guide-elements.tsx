/**
 * Guide schema definition and shared enums (Phase-2 frontmatter, no body).
 *
 * The guide is the "theory of user" for any domain — a living document
 * capturing triage rules, named actions, experiments, reactions, and
 * context notes. Everything is structured metadata (the parser flattens it
 * into `ParsedGuide`), so it lives in YAML frontmatter; per-rule
 * confidence/source are just fields on each rule object.
 */

import { z } from "zod";
import { cardSchema, type CardSchema } from "../cards/index.js";

// ============================================
// Shared enums
// ============================================

export const ConfidenceLevel = z.enum([
  "confirmed",
  "high",
  "medium",
  "low",
  "hypothesis",
]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevel>;

export const BeliefSource = z.enum([
  "user-stated",
  "feedback",
  "inferred",
  "default",
]);
export type BeliefSource = z.infer<typeof BeliefSource>;

export const ExperimentStatus = z.enum([
  "proposed",
  "active",
  "successful",
  "unsuccessful",
  "mixed",
  "inconclusive",
]);
export type ExperimentStatus = z.infer<typeof ExperimentStatus>;

export const ReactionSentiment = z.enum([
  "positive",
  "negative",
  "neutral",
]);
export type ReactionSentiment = z.infer<typeof ReactionSentiment>;

const ContextDuration = z.enum(["ongoing", "temporary", "past"]);

// ============================================
// Field validators
// ============================================

const Iso = z.string().datetime({ offset: true });

const TriageRuleField = z.object({
  text: z.string(),
  confidence: ConfidenceLevel.default("low"),
  source: BeliefSource.default("inferred"),
  ref: z.string().optional(),
  action: z.string().optional(),
});

const DefaultActionField = z.object({
  action: z.string(),
  text: z.string().optional(),
});

const ActionField = z.object({
  name: z.string(),
  when: z.string().optional(),
  instructions: z.string().optional(),
});

const ObservationField = z.object({
  text: z.string(),
  ref: z.string().optional(),
  date: z.string().optional(),
});

const ExperimentField = z.object({
  id: z.string(),
  status: ExperimentStatus.default("proposed"),
  "created-at": Iso.optional(),
  "updated-at": Iso.optional(),
  hypothesis: z.string().optional(),
  approach: z.string().optional(),
  observations: z.array(ObservationField).optional(),
  conclusion: z.string().optional(),
});

const ReactionField = z.object({
  id: z.string(),
  sentiment: ReactionSentiment.default("neutral"),
  text: z.string(),
});

const ContextNoteField = z.object({
  text: z.string(),
  duration: ContextDuration.default("ongoing"),
  "added-at": Iso.optional(),
});

const guideFields = {
  version: z.string().default("1.0.0"),
  "job-types": z.array(z.string()).optional(),
  "applies-to": z.string().optional(),
  "triage-rules": z.array(TriageRuleField).optional(),
  "default-action": DefaultActionField.optional(),
  actions: z.array(ActionField).optional(),
  experiments: z.array(ExperimentField).optional(),
  reactions: z.array(ReactionField).optional(),
  "context-notes": z.array(ContextNoteField).optional(),
};

export const GuideSchema: CardSchema = cardSchema("guide", {
  searchable: false,
  fields: guideFields,
  instructions: `# Handling Guides

A guide is a living document — the theory of the user. Treat it as a model to be refined, not a static config. It is pure YAML frontmatter (no body).

**Confidence ladder:** hypothesis → low → medium → high → confirmed. Only upgrade when there's evidence. Only downgrade when evidence contradicts. Never jump from hypothesis to confirmed in one step.

**Source hierarchy:** user-stated > feedback > inferred > default. A user-stated belief overrides anything inferred.

**ALWAYS have active experiments.** If all experiments are resolved, propose new ones. Experiments are how the system learns — without them it stagnates. Aim for 1-3 active experiments at any time.

**\`triage-rules\`** is a list of \`{ text, confidence, source, ref?, action? }\`. A rule's \`action\` names an entry in \`actions\`. \`default-action\` says what happens when no rule matches.

**\`actions\`** are named things the agent can do (proper nouns like "Write Brief", "Archive"). Each is \`{ name, when?, instructions? }\`.

When revising based on feedback: cite the specific source in a rule's \`ref\` and explain changes in experiment \`observations\`. Every change should be traceable to evidence.

Don't remove rules just because one interaction got a "meh" rating. Look for patterns across multiple interactions before downgrading confidence.`,
});

/** Standalone object schema for parsing a guide's frontmatter directly. */
export const GuideObject = z.object(guideFields);
export type GuideFields = z.infer<typeof GuideObject>;
/** Back-compat alias for the guide fields type. */
export type Guide = GuideFields;

// ============================================
// Parsed guide
// ============================================

export interface ParsedGuide {
  version: string;
  jobTypes: string[];
  appliesTo: string | undefined;
  triageRules: Array<{
    text: string;
    confidence: ConfidenceLevel;
    source: BeliefSource;
    ref: string | undefined;
    action: string | undefined;
  }>;
  defaultAction: {
    action: string;
    text: string | undefined;
  } | undefined;
  actions: Array<{
    name: string;
    when: string | undefined;
    instructions: string | undefined;
  }>;
  experiments: Array<{
    id: string;
    status: ExperimentStatus;
    createdAt: string | undefined;
    updatedAt: string | undefined;
    hypothesis: string | undefined;
    approach: string | undefined;
    observations: Array<{
      text: string;
      ref: string | undefined;
      date: string | undefined;
    }>;
    conclusion: string | undefined;
  }>;
  reactions: Array<{
    id: string;
    sentiment: ReactionSentiment;
    text: string;
  }>;
  contextNotes: Array<{
    text: string;
    duration: "ongoing" | "temporary" | "past";
    addedAt: string | undefined;
  }>;
}
