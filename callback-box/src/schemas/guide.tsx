/**
 * Generic guide schema - the "theory of user" for any domain.
 *
 * A guide is a living document that captures:
 * - Triage rules (what matters, with confidence levels)
 * - Named actions the agent can take
 * - Experiments to test hypotheses
 * - Reactions for user feedback
 * - Context notes affecting decisions
 *
 * Guides live at config/*.guide.card. The filename stem is the identity
 * (e.g., config/news.guide.card, config/intake.guide.card).
 *
 * The full guide is the learning document (read by the revision agent).
 * A compiled version in docs/generated/ strips it down to actionable
 * rules for job-processing agents.
 */

import { element, type ElementNode } from "cardworks";
import { z } from "zod";

// ============================================
// Shared enums (also used by news-guide.tsx)
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

function getChild(children: ElementNode[], tagName: string): ElementNode | undefined {
  return children.find((c) => c.tagName === tagName);
}

function getChildren(children: ElementNode[], tagName: string): ElementNode[] {
  return children.filter((c) => c.tagName === tagName);
}

/**
 * Parse a guide element into a typed structure.
 */
export function parseGuide(guide: Guide): ParsedGuide {
  const children = guide.children as ElementNode[];
  const jobTypesAttr = guide.attrs["job-types"] as string | undefined;

  const appliesToEl = getChild(children, "applies-to");
  const triageEl = getChild(children, "triage");
  const actionsEl = getChild(children, "actions");
  const experimentsEl = getChild(children, "experiments");
  const reactionsEl = getChild(children, "reactions");
  const contextNotesEl = getChild(children, "context-notes");

  // Parse triage
  const triageChildren = (triageEl?.children ?? []) as ElementNode[];
  const triageRules = getChildren(triageChildren, "rule").map((r) => ({
    text: r.text ?? "",
    confidence: (r.attrs.confidence ?? "low") as ConfidenceLevel,
    source: (r.attrs.source ?? "inferred") as BeliefSource,
    ref: r.attrs.ref as string | undefined,
    action: r.attrs.action as string | undefined,
  }));

  const defaultActionEl = getChild(triageChildren, "default-action");
  const defaultAction = defaultActionEl
    ? {
        action: defaultActionEl.attrs.action as string,
        text: defaultActionEl.text ?? undefined,
      }
    : undefined;

  // Parse actions
  const actionChildren = (actionsEl?.children ?? []) as ElementNode[];
  const actions = getChildren(actionChildren, "action").map((a) => {
    const aChildren = (a.children ?? []) as ElementNode[];
    const whenEl = getChild(aChildren, "when");
    const instrEl = getChild(aChildren, "instructions");
    return {
      name: a.attrs.name as string,
      when: whenEl?.text ?? undefined,
      instructions: instrEl?.text ?? undefined,
    };
  });

  // Parse experiments
  const experimentChildren = (experimentsEl?.children ?? []) as ElementNode[];
  const experiments = getChildren(experimentChildren, "experiment").map((e) => {
    const expChildren = (e.children ?? []) as ElementNode[];
    const hypothesisEl = getChild(expChildren, "hypothesis");
    const approachEl = getChild(expChildren, "approach");
    const conclusionEl = getChild(expChildren, "conclusion");
    const observationEls = getChildren(expChildren, "observation");

    return {
      id: e.attrs.id as string,
      status: (e.attrs.status ?? "proposed") as ExperimentStatus,
      createdAt: e.attrs["created-at"] as string | undefined,
      updatedAt: e.attrs["updated-at"] as string | undefined,
      hypothesis: hypothesisEl?.text,
      approach: approachEl?.text,
      observations: observationEls.map((o) => ({
        text: o.text ?? "",
        ref: o.attrs.ref as string | undefined,
        date: o.attrs.date as string | undefined,
      })),
      conclusion: conclusionEl?.text,
    };
  });

  // Parse reactions
  const reactionChildren = (reactionsEl?.children ?? []) as ElementNode[];
  const reactions = getChildren(reactionChildren, "reaction").map((r) => ({
    id: r.attrs.id as string,
    sentiment: (r.attrs.sentiment ?? "neutral") as ReactionSentiment,
    text: r.text ?? "",
  }));

  // Parse context notes
  const contextChildren = (contextNotesEl?.children ?? []) as ElementNode[];
  const contextNotes = getChildren(contextChildren, "context").map((c) => ({
    text: c.text ?? "",
    duration: (c.attrs.duration ?? "ongoing") as "ongoing" | "temporary" | "past",
    addedAt: c.attrs["added-at"] as string | undefined,
  }));

  return {
    version: guide.attrs.version as string,
    jobTypes: jobTypesAttr ? jobTypesAttr.split(/\s+/).filter(Boolean) : [],
    appliesTo: appliesToEl?.text ?? undefined,
    triageRules,
    defaultAction,
    actions,
    experiments,
    reactions,
    contextNotes,
  };
}

// ============================================
// Compile guide to actionable markdown
// ============================================

/**
 * Compile a parsed guide into concise actionable markdown.
 *
 * Strips evidence metadata, concluded experiments, past context.
 * Keeps only what a job-processing agent needs.
 */
export function compileGuide(parsed: ParsedGuide, guideName: string): string {
  const lines: string[] = [];
  const title = guideName.charAt(0).toUpperCase() + guideName.slice(1);
  lines.push(`# ${title} Guide`);
  lines.push("");

  if (parsed.appliesTo) {
    lines.push(parsed.appliesTo);
    lines.push("");
  }

  // Triage rules (skip hypothesis-level)
  const significantRules = parsed.triageRules.filter(
    (r) => r.confidence !== "hypothesis"
  );
  if (significantRules.length > 0 || parsed.defaultAction) {
    lines.push("## Triage Rules");
    lines.push("");
    for (const rule of significantRules) {
      const actionLabel = rule.action ? `**${rule.action}**` : "**Note**";
      lines.push(`- ${actionLabel}: ${rule.text}`);
    }
    if (parsed.defaultAction) {
      const text = parsed.defaultAction.text
        ? ` — ${parsed.defaultAction.text}`
        : "";
      lines.push(`- **Default → ${parsed.defaultAction.action}**${text}`);
    }
    lines.push("");
  }

  // Actions
  if (parsed.actions.length > 0) {
    lines.push("## Actions");
    lines.push("");
    for (const action of parsed.actions) {
      lines.push(`### ${action.name}`);
      if (action.when) {
        lines.push(`**When:** ${action.when}`);
      }
      if (action.instructions) {
        lines.push(action.instructions);
      }
      lines.push("");
    }
  }

  // Active experiments only (proposed or active)
  const activeExperiments = parsed.experiments.filter(
    (e) => e.status === "active" || e.status === "proposed"
  );
  if (activeExperiments.length > 0) {
    lines.push("## Active Experiments");
    lines.push("");
    for (const exp of activeExperiments) {
      const status = exp.status === "proposed" ? " (proposed)" : "";
      const hypothesis = exp.hypothesis ? `: ${exp.hypothesis}` : "";
      lines.push(`- **${exp.id}**${status}${hypothesis}`);
      if (exp.approach) {
        lines.push(`  Approach: ${exp.approach}`);
      }
    }
    lines.push("");
  }

  // Context (ongoing and temporary only)
  const currentContext = parsed.contextNotes.filter(
    (c) => c.duration !== "past"
  );
  if (currentContext.length > 0) {
    lines.push("## Context");
    lines.push("");
    for (const note of currentContext) {
      const label = note.duration === "temporary" ? " (temporary)" : "";
      lines.push(`- ${note.text}${label}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================
// Initial guide templates
// ============================================

/**
 * Domain-specific seed configurations for initial guides.
 */
interface GuideSeed {
  jobTypes: string;
  appliesTo: string;
  actions: Array<{ name: string; when: string; instructions: string }>;
  triageRules: string[];
  defaultAction: { action: string; text: string };
  experiment: { id: string; hypothesis: string; approach: string };
  reactions: Array<{ id: string; sentiment: string; text: string }>;
}

const DOMAIN_SEEDS: Record<string, GuideSeed> = {
  news: {
    jobTypes: "news-job",
    appliesTo: "Use when processing news items from RSS feeds",
    actions: [
      {
        name: "Write Brief",
        when: "After processing news items, when there are enough worth covering",
        instructions: "Group by theme. Use direct headlines. Include expandos for depth. Reference the guide for tone and style preferences.",
      },
      {
        name: "Skip",
        when: "Item doesn't match interests or is low quality",
        instructions: "Trash the item with cb rm",
      },
      {
        name: "Ask User",
        when: "Unsure about disposition or need clarification",
        instructions: "Create a question card in box/questions/",
      },
    ],
    triageRules: [],
    defaultAction: {
      action: "Write Brief",
      text: "When no specific rule applies, include if it seems technical and substantive",
    },
    experiment: {
      id: "exp-initial",
      hypothesis: "Initial triage rules need calibration through reader feedback",
      approach: "Present diverse content, note what gets engagement vs gets skipped",
    },
    reactions: [
      { id: "good-mix", sentiment: "positive", text: "Good mix of topics" },
      { id: "too-long", sentiment: "negative", text: "This felt too long" },
      { id: "want-more", sentiment: "positive", text: "I want more on this topic" },
      { id: "already-knew", sentiment: "neutral", text: "I already knew most of this" },
      { id: "off-topic", sentiment: "negative", text: "Topics I don't care about" },
    ],
  },
  intake: {
    jobTypes: "intake-job",
    appliesTo: "Use when triaging new inbox items (memos, bookmarks, captures)",
    actions: [
      {
        name: "Archive",
        when: "Item is useful reference material",
        instructions: "Move to store/archive/ with appropriate subdirectory",
      },
      {
        name: "Convert to Recipe",
        when: "Item contains a recipe or cooking instructions",
        instructions: "Create a recipe card in store/recipes/ using cb create, then trash the original",
      },
      {
        name: "Keep for Reading",
        when: "Item is worth reading later but not urgent",
        instructions: "Move to box/pool/ for later processing",
      },
      {
        name: "Trash",
        when: "Item is not useful or relevant",
        instructions: "Use cb rm to soft-delete",
      },
      {
        name: "Ask User",
        when: "Unsure about disposition or need clarification",
        instructions: "Create a question card in box/questions/",
      },
    ],
    triageRules: [
      "Recipes and cooking content → Convert to Recipe",
      "Reference material and documentation → Archive",
    ],
    defaultAction: {
      action: "Ask User",
      text: "When unsure about an item, ask the user what to do with it",
    },
    experiment: {
      id: "exp-initial",
      hypothesis: "Initial triage rules need calibration through user feedback",
      approach: "Triage conservatively, ask when unsure, learn from answers",
    },
    reactions: [],
  },
  calendar: {
    jobTypes: "calendar-review-job",
    appliesTo: "Use when reviewing calendar event changes (new, updated, deleted)",
    actions: [
      {
        name: "Create Reminder",
        when: "Event needs preparation (meeting prep, travel, etc.)",
        instructions: "Create a memo card in box/inbox/ with preparation notes",
      },
      {
        name: "Note Change",
        when: "Significant change that user should know about (time/location change, cancellation)",
        instructions: "Create a memo card highlighting what changed and any needed adjustments",
      },
      {
        name: "Ignore",
        when: "Routine change that doesn't need attention",
        instructions: "No action needed — just review and move on",
      },
    ],
    triageRules: [],
    defaultAction: {
      action: "Ignore",
      text: "Most calendar changes are informational and don't need action",
    },
    experiment: {
      id: "exp-initial",
      hypothesis: "Most calendar changes need no action",
      approach: "Default to ignoring, learn which events actually need preparation",
    },
    reactions: [],
  },
};

/**
 * Create an initial guide template for a given domain.
 */
export function createInitialGuideTemplate(options: { name: string }): string {
  const seed = DOMAIN_SEEDS[options.name];
  const now = new Date().toISOString();

  if (!seed) {
    // Generic fallback
    return `<guide version="1.0.0">
  <applies-to>Describe when this guide applies</applies-to>

  <triage>
    <!-- Add rules as you learn what matters -->
    <default-action action="Ask User">When unsure, ask the user</default-action>
  </triage>

  <actions>
    <action name="Ask User">
      <when>Unsure about disposition</when>
      <instructions>Create a question card in box/questions/</instructions>
    </action>
  </actions>

  <experiments>
    <experiment id="exp-initial" status="active" created-at="${now}">
      <hypothesis>Initial rules need calibration through feedback</hypothesis>
      <approach>Start conservative, learn from user responses</approach>
    </experiment>
  </experiments>

  <reactions>
  </reactions>

  <context-notes>
  </context-notes>
</guide>
`;
  }

  const triageRulesXml = seed.triageRules
    .map((r) => `    <rule confidence="low" source="default">${r}</rule>`)
    .join("\n");

  const actionsXml = seed.actions
    .map(
      (a) => `    <action name="${a.name}">
      <when>${a.when}</when>
      <instructions>${a.instructions}</instructions>
    </action>`
    )
    .join("\n");

  const reactionsXml = seed.reactions
    .map((r) => `    <reaction id="${r.id}" sentiment="${r.sentiment}">${r.text}</reaction>`)
    .join("\n");

  return `<guide version="1.0.0" job-types="${seed.jobTypes}">
  <applies-to>${seed.appliesTo}</applies-to>

  <triage>
${triageRulesXml ? triageRulesXml + "\n" : ""}    <default-action action="${seed.defaultAction.action}">${seed.defaultAction.text}</default-action>
  </triage>

  <actions>
${actionsXml}
  </actions>

  <experiments>
    <experiment id="${seed.experiment.id}" status="active" created-at="${now}">
      <hypothesis>${seed.experiment.hypothesis}</hypothesis>
      <approach>${seed.experiment.approach}</approach>
    </experiment>
  </experiments>

  <reactions>
${reactionsXml ? reactionsXml + "\n" : ""}  </reactions>

  <context-notes>
  </context-notes>
</guide>
`;
}
