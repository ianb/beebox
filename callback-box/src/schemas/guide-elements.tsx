/**
 * Guide schema element definitions and shared enums.
 *
 * The guide is the "theory of user" for any domain — a living document
 * capturing triage rules, named actions, experiments, reactions, and
 * context notes. This module holds the cardworks `element()` definitions
 * and the Zod-inferred types; parsing/compiling/templating live in sibling
 * modules.
 */

import { element } from "cardworks";
import { z } from "zod";

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

// ============================================
// Guide elements
// ============================================

/**
 * Natural language description of when this guide applies.
 */
export const AppliesTo = element("applies-to", {
  text: z.string(),
});

/**
 * A triage rule — guidance for what matters.
 */
export const TriageRule = element("rule", {
  attrs: {
    confidence: ConfidenceLevel.default("low"),
    source: BeliefSource.default("inferred"),
    ref: z.string().optional(),
    /** Optional action name to take when this rule matches */
    action: z.string().optional(),
  },
  text: z.string(),
});

/**
 * Default action when no triage rule matches.
 */
export const DefaultAction = element("default-action", {
  attrs: {
    action: z.string(),
  },
  text: z.string().optional(),
});

/**
 * Container for triage rules.
 */
export const Triage = element("triage", {
  children: z.array(z.union([TriageRule, DefaultAction])),
});

/**
 * When an action should be taken.
 */
export const ActionWhen = element("when", {
  text: z.string(),
});

/**
 * Instructions for how to perform an action.
 */
export const ActionInstructions = element("instructions", {
  text: z.string(),
});

/**
 * A named action the agent can take.
 */
export const Action = element("action", {
  attrs: {
    name: z.string(),
  },
  children: z.array(z.union([ActionWhen, ActionInstructions])),
});

/**
 * Container for actions.
 */
export const Actions = element("actions", {
  children: z.array(Action),
});

/**
 * An experiment — a direction to try.
 */
export const Experiment = element("experiment", {
  attrs: {
    id: z.string(),
    status: ExperimentStatus.default("proposed"),
    "created-at": z.string().datetime({ offset: true }).optional(),
    "updated-at": z.string().datetime({ offset: true }).optional(),
  },
  children: z.array(
    z.union([
      element("hypothesis", { text: z.string() }),
      element("approach", { text: z.string() }),
      element("tested-in", {
        attrs: {
          ref: z.string(),
          date: z.string().optional(),
        },
        text: z.string().optional(),
      }),
      element("observation", {
        attrs: {
          ref: z.string().optional(),
          date: z.string().optional(),
        },
        text: z.string(),
      }),
      element("conclusion", { text: z.string() }),
    ])
  ),
});

/**
 * Container for experiments.
 */
export const Experiments = element("experiments", {
  children: z.array(Experiment),
});

/**
 * A reaction option for user feedback.
 */
export const Reaction = element("reaction", {
  attrs: {
    id: z.string(),
    sentiment: ReactionSentiment.default("neutral"),
  },
  text: z.string(),
});

/**
 * Container for reactions.
 */
export const Reactions = element("reactions", {
  children: z.array(Reaction),
});

/**
 * A context note — situational info affecting decisions.
 */
export const ContextNote = element("context", {
  attrs: {
    duration: z.enum(["ongoing", "temporary", "past"]).default("ongoing"),
    "added-at": z.string().datetime({ offset: true }).optional(),
  },
  text: z.string(),
});

/**
 * Container for context notes.
 */
export const ContextNotes = element("context-notes", {
  children: z.array(ContextNote),
});

// ============================================
// Guide schema
// ============================================

export const GuideSchema = element("guide", {
  attrs: {
    version: z.string().default("1.0.0"),
    /** Space-separated job types this guide applies to */
    "job-types": z.string().optional(),
  },
  children: z.array(
    z.union([
      AppliesTo,
      Triage,
      Actions,
      Experiments,
      Reactions,
      ContextNotes,
    ])
  ),
  instructions: `# Handling Guides

A guide is a living document — the theory of the user. Treat it as a model to be refined, not a static config.

**Confidence ladder:** hypothesis → low → medium → high → confirmed. Only upgrade when there's evidence. Only downgrade when evidence contradicts. Never jump from hypothesis to confirmed in one step.

**Source hierarchy:** user-stated > feedback > inferred > default. A user-stated belief overrides anything inferred.

**ALWAYS have active experiments.** If all experiments are resolved, propose new ones. Experiments are how the system learns — without them it stagnates. Aim for 1-3 active experiments at any time.

**Triage rules** can reference named actions with the \`action\` attribute. The \`<default-action>\` specifies what happens when no rule matches.

**Actions** are named things the agent can do (proper nouns like "Write Brief", "Archive"). Each has \`<when>\` conditions and \`<instructions>\`.

When revising based on feedback: cite the specific source in \`ref\` attributes and explain changes in experiment observations. Every change should be traceable to evidence.

Don't remove rules just because one interaction got a "meh" rating. Look for patterns across multiple interactions before downgrading confidence.`,
});

export type Guide = z.infer<typeof GuideSchema>;

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
