/** @jsxImportSource cardworks/jsx */
/**
 * News guide schema - the theory of user for news curation.
 *
 * @deprecated Use the generic guide schema from ./guide.tsx instead.
 * This module is kept for backward compatibility with existing news-guide cards.
 * New guides should use the `<guide>` element type. Migration is handled by `cb init`.
 *
 * This is a living document that captures:
 * - What we know about the user's interests (with confidence levels)
 * - Hypotheses to test through editions
 * - Experiments (directions to try)
 * - Evidence from feedback
 *
 * The guide influences how editions are created and evolves based on
 * user feedback on those editions.
 */

import { element, type ElementNode } from "cardworks";
import { z } from "zod";

/**
 * Confidence levels for beliefs about the user.
 */
export const ConfidenceLevel = z.enum([
  "confirmed",    // User explicitly stated or strongly confirmed
  "high",         // Strong evidence from multiple interactions
  "medium",       // Some evidence, reasonable inference
  "low",          // Weak inference, needs testing
  "hypothesis",   // Untested theory
]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevel>;

/**
 * Source of a belief - how we came to believe this.
 */
export const BeliefSource = z.enum([
  "user-stated",  // User explicitly told us
  "feedback",     // Inferred from feedback on editions
  "inferred",     // Inferred from news sources or behavior
  "default",      // Reasonable default assumption
]);
export type BeliefSource = z.infer<typeof BeliefSource>;

/**
 * A topic or theme the user is interested in.
 */
export const InterestTopic = element("topic", {
  attrs: {
    /** How confident we are in this interest */
    confidence: ConfidenceLevel.default("low"),
    /** How we learned about this interest */
    source: BeliefSource.default("inferred"),
    /** Reference to evidence (edition path, feedback, etc.) */
    ref: z.string().optional(),
  },
  /** The topic name */
  text: z.string(),
});

/**
 * Container for interest topics.
 */
export const Interests = element("interests", {
  children: z.array(InterestTopic),
});

/**
 * A preference about how content should be presented.
 */
export const Preference = element("preference", {
  attrs: {
    /** What aspect this preference affects */
    aspect: z.enum([
      "depth",        // How deep to go (surface vs detailed)
      "tone",         // Casual, academic, etc.
      "frequency",    // How often to cover topic
      "format",       // Expandos, queries, length, etc.
      "sources",      // Preferred source types
      "structure",    // How content is organized/presented
      "headlines",    // Headline style preferences
      "other",
    ]),
    confidence: ConfidenceLevel.default("low"),
    source: BeliefSource.default("inferred"),
    ref: z.string().optional(),
  },
  /** Description of the preference */
  text: z.string(),
});

/**
 * Container for preferences.
 */
export const Preferences = element("preferences", {
  children: z.array(Preference),
});

/**
 * An anti-interest - something the user doesn't want.
 */
export const Disinterest = element("disinterest", {
  attrs: {
    confidence: ConfidenceLevel.default("low"),
    source: BeliefSource.default("inferred"),
    ref: z.string().optional(),
  },
  /** What the user isn't interested in */
  text: z.string(),
});

/**
 * Container for anti-interests.
 */
export const Disinterests = element("disinterests", {
  children: z.array(Disinterest),
});

/**
 * Experiment status.
 */
export const ExperimentStatus = z.enum([
  "proposed",     // Idea, not yet tried
  "active",       // Currently being tested
  "successful",   // Worked well, should continue
  "unsuccessful", // Didn't work, should stop
  "mixed",        // Partial success, needs refinement
  "inconclusive", // Tried but unclear results
]);
export type ExperimentStatus = z.infer<typeof ExperimentStatus>;

/**
 * An experiment - a direction to try in editions.
 *
 * Experiments are ways to explore the user's interests or try
 * new approaches. They have outcomes that inform future behavior.
 */
export const Experiment = element("experiment", {
  attrs: {
    /** Unique ID for referencing from editions */
    id: z.string(),
    /** Current status */
    status: ExperimentStatus.default("proposed"),
    /** When this experiment was created */
    "created-at": z.string().datetime({ offset: true }).optional(),
    /** When status last changed */
    "updated-at": z.string().datetime({ offset: true }).optional(),
  },
  children: z.array(
    z.union([
      /** What we're trying */
      element("hypothesis", { text: z.string() }),
      /** How we'll test it */
      element("approach", { text: z.string() }),
      /** Reference to brief where experiment was tested */
      element("tested-in", {
        attrs: {
          /** Reference to brief */
          ref: z.string(),
          date: z.string().optional(),
        },
        text: z.string().optional(),
      }),
      /** What we observed */
      element("observation", {
        attrs: {
          /** Reference to edition or feedback */
          ref: z.string().optional(),
          date: z.string().optional(),
        },
        text: z.string(),
      }),
      /** Conclusion drawn */
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
 * A note about context that might affect curation.
 * E.g., "User is starting a new job in ML" or "Conference season".
 */
export const ContextNote = element("context", {
  attrs: {
    /** When this context applies (ongoing, temporary, etc.) */
    duration: z.enum(["ongoing", "temporary", "past"]).default("ongoing"),
    /** When added */
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

/**
 * Sentiment for a reader reaction.
 */
export const ReactionSentiment = z.enum([
  "positive",   // Good feedback, confirms approach
  "negative",   // Problem feedback, triggers guide revision
  "neutral",    // Informational, no strong signal
]);
export type ReactionSentiment = z.infer<typeof ReactionSentiment>;

/**
 * A reaction option for reader feedback.
 *
 * These are predefined options the user can select after reading a brief.
 * The agent defines these in the guide based on what feedback would be useful.
 *
 * Example:
 * ```xml
 * <reader-reactions>
 *   <reaction id="too-long" sentiment="negative">This felt too long</reaction>
 *   <reaction id="want-more" sentiment="positive">I want more on this topic</reaction>
 *   <reaction id="already-knew" sentiment="neutral">I already knew most of this</reaction>
 * </reader-reactions>
 * ```
 */
export const ReaderReaction = element("reaction", {
  attrs: {
    /** Unique ID for this reaction */
    id: z.string(),
    /** Sentiment category - negative reactions trigger guide revision */
    sentiment: ReactionSentiment.default("neutral"),
  },
  /** The reaction text shown to the user */
  text: z.string(),
});

/**
 * Container for reader reactions.
 */
export const ReaderReactions = element("reader-reactions", {
  children: z.array(ReaderReaction),
});

/**
 * The news guide schema.
 *
 * Example:
 * ```xml
 * <news-guide version="1">
 *   <updated-at>2026-02-01T12:00:00Z</updated-at>
 *
 *   <interests>
 *     <topic confidence="high" source="feedback" evidence="edition:2026-01-28">
 *       AI safety and alignment
 *     </topic>
 *     <topic confidence="medium" source="inferred">
 *       Systems programming
 *     </topic>
 *     <topic confidence="hypothesis" source="inferred">
 *       Retro computing
 *     </topic>
 *   </interests>
 *
 *   <disinterests>
 *     <disinterest confidence="confirmed" source="user-stated">
 *       Cryptocurrency price news
 *     </disinterest>
 *   </disinterests>
 *
 *   <preferences>
 *     <preference aspect="depth" confidence="medium" source="feedback">
 *       Prefers technical depth over surface summaries
 *     </preference>
 *     <preference aspect="tone" confidence="low" source="inferred">
 *       Appreciates dry humor and contrarian takes
 *     </preference>
 *   </preferences>
 *
 *   <context-notes>
 *     <context duration="temporary" added-at="2026-01-15T00:00:00Z">
 *       Following EU AI Act developments closely
 *     </context>
 *   </context-notes>
 *
 *   <experiments>
 *     <experiment id="exp-retro" status="active" created-at="2026-01-30T00:00:00Z">
 *       <hypothesis>User enjoys retro computing content as a change of pace</hypothesis>
 *       <approach>Include one retro computing piece per edition when available</approach>
 *       <observation ref="edition:2026-02-01" date="2026-02-01">
 *         Amiga Unix piece was included, awaiting feedback
 *       </observation>
 *     </experiment>
 *     <experiment id="exp-queries" status="inconclusive" created-at="2026-01-20T00:00:00Z">
 *       <hypothesis>Interactive queries increase engagement</hypothesis>
 *       <approach>Add 1-2 queries per edition asking about interests</approach>
 *       <observation date="2026-01-25">Queries rarely answered</observation>
 *       <conclusion>Queries may be ignored; try less frequently</conclusion>
 *     </experiment>
 *   </experiments>
 * </news-guide>
 * ```
 *
 * @deprecated Use GuideSchema from ./guide.tsx instead.
 */
export const NewsGuideSchema = element("news-guide", {
  attrs: {
    /** Schema version for migrations */
    version: z.string().default("1"),
  },
  children: z.array(
    z.union([
      /** When this guide was last updated */
      element("updated-at", { text: z.string().datetime({ offset: true }) }),
      Interests,
      Disinterests,
      Preferences,
      ContextNotes,
      Experiments,
      ReaderReactions,
    ])
  ),
  instructions: `# Handling News Guide

This is a living document — the theory of the user. Treat it as a model to be refined, not a static config.

**Confidence ladder:** hypothesis → low → medium → high → confirmed. Only upgrade when there's evidence. Only downgrade when evidence contradicts. Never jump from hypothesis to confirmed in one step.

**Source hierarchy:** user-stated > feedback > inferred > default. A user-stated belief overrides anything inferred.

**ALWAYS have active experiments.** If all experiments are resolved, propose new ones. Experiments are how the system learns — without them it stagnates. Aim for 1-3 active experiments at any time.

Use <topic> elements inside <interests>, NOT <interest>. The container is <interests>, the children are <topic>.

When revising based on brief feedback: cite the specific brief in \`ref\` attributes, update \`updated-at\`, and explain changes in experiment observations. Every change should be traceable to evidence.

Don't remove topics just because one brief got a "meh" rating. Look for patterns across multiple briefs before downgrading confidence.`,
});

export type NewsGuide = z.infer<typeof NewsGuideSchema>;

/**
 * Parsed guide with typed accessors.
 */
export interface ParsedNewsGuide {
  version: string;
  updatedAt: string | undefined;
  interests: Array<{
    topic: string;
    confidence: ConfidenceLevel;
    source: BeliefSource;
    ref: string | undefined;
  }>;
  disinterests: Array<{
    topic: string;
    confidence: ConfidenceLevel;
    source: BeliefSource;
    ref: string | undefined;
  }>;
  preferences: Array<{
    aspect: string;
    description: string;
    confidence: ConfidenceLevel;
    source: BeliefSource;
    ref: string | undefined;
  }>;
  contextNotes: Array<{
    text: string;
    duration: "ongoing" | "temporary" | "past";
    addedAt: string | undefined;
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
  readerReactions: Array<{
    id: string;
    sentiment: ReactionSentiment;
    text: string;
  }>;
}

/**
 * Helper to extract child element by tag name.
 */
function getChild(children: ElementNode[], tagName: string): ElementNode | undefined {
  return children.find((c) => c.tagName === tagName);
}

/**
 * Helper to extract all children by tag name.
 */
function getChildren(children: ElementNode[], tagName: string): ElementNode[] {
  return children.filter((c) => c.tagName === tagName);
}

/**
 * Parse a news guide element into a typed structure.
 */
export function parseNewsGuide(guide: NewsGuide): ParsedNewsGuide {
  const children = guide.children as ElementNode[];

  const updatedAtEl = getChild(children, "updated-at");
  const interestsEl = getChild(children, "interests");
  const disinterestsEl = getChild(children, "disinterests");
  const preferencesEl = getChild(children, "preferences");
  const contextNotesEl = getChild(children, "context-notes");
  const experimentsEl = getChild(children, "experiments");
  const readerReactionsEl = getChild(children, "reader-reactions");

  // Parse interests
  const interestChildren = (interestsEl?.children ?? []) as ElementNode[];
  const interests = getChildren(interestChildren, "topic").map((t) => ({
    topic: t.text ?? "",
    confidence: (t.attrs.confidence ?? "low") as ConfidenceLevel,
    source: (t.attrs.source ?? "inferred") as BeliefSource,
    ref: t.attrs.ref as string | undefined,
  }));

  // Parse disinterests
  const disinterestChildren = (disinterestsEl?.children ?? []) as ElementNode[];
  const disinterests = getChildren(disinterestChildren, "disinterest").map((d) => ({
    topic: d.text ?? "",
    confidence: (d.attrs.confidence ?? "low") as ConfidenceLevel,
    source: (d.attrs.source ?? "inferred") as BeliefSource,
    ref: d.attrs.ref as string | undefined,
  }));

  // Parse preferences
  const preferenceChildren = (preferencesEl?.children ?? []) as ElementNode[];
  const preferences = getChildren(preferenceChildren, "preference").map((p) => ({
    aspect: (p.attrs.aspect ?? "other") as string,
    description: p.text ?? "",
    confidence: (p.attrs.confidence ?? "low") as ConfidenceLevel,
    source: (p.attrs.source ?? "inferred") as BeliefSource,
    ref: p.attrs.ref as string | undefined,
  }));

  // Parse context notes
  const contextChildren = (contextNotesEl?.children ?? []) as ElementNode[];
  const contextNotes = getChildren(contextChildren, "context").map((c) => ({
    text: c.text ?? "",
    duration: (c.attrs.duration ?? "ongoing") as "ongoing" | "temporary" | "past",
    addedAt: c.attrs["added-at"] as string | undefined,
  }));

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

  // Parse reader reactions
  const readerReactionChildren = (readerReactionsEl?.children ?? []) as ElementNode[];
  const readerReactions = getChildren(readerReactionChildren, "reaction").map((r) => ({
    id: r.attrs.id as string,
    sentiment: (r.attrs.sentiment ?? "neutral") as ReactionSentiment,
    text: r.text ?? "",
  }));

  return {
    version: guide.attrs.version as string,
    updatedAt: updatedAtEl?.text,
    interests,
    disinterests,
    preferences,
    contextNotes,
    experiments,
    readerReactions,
  };
}

/**
 * Options for creating an initial guide.
 */
export interface InitialGuideOptions {
  /** RSS feed URLs to infer interests from */
  feedUrls?: string[];
  /** Feed titles to infer interests from */
  feedTitles?: string[];
}

/**
 * Create an initial guide template.
 *
 * Creates a minimal guide with XML comments explaining each section.
 * The agent should fill in actual content based on available news sources.
 */
export function createInitialGuideTemplate(_options: InitialGuideOptions = {}): string {
  const now = new Date().toISOString();

  // Use raw XML string to include comments - JSX doesn't support XML comments
  return `<news-guide version="1.0.0">
  <updated-at>${now}</updated-at>

  <!-- INTERESTS: Topics the reader cares about. Infer from:
       - What news sources they've subscribed to
       - What types of articles are in the pool
       - Common themes in their feed selection
       Use confidence="hypothesis" for initial guesses. -->
  <interests>
    <!-- Example: <topic confidence="hypothesis" source="inferred">Topic name</topic> -->
  </interests>

  <!-- DISINTERESTS: What to avoid. Infer from:
       - Topics conspicuously absent from their feeds
       - Types of content that seem off-brand
       Start empty - better to include too much than wrongly exclude. -->
  <disinterests>
  </disinterests>

  <!-- PREFERENCES: How to present content. Start with sensible defaults:
       - depth: balance of surface vs technical detail
       - tone: conversational, informative, not breathless or alarmist
       - format: how to structure editions -->
  <preferences>
    <preference aspect="tone" confidence="low" source="default">
      Informative and curious. Direct headlines that say what happened,
      not clickbait that hides the point. Trust the reader's intelligence.
    </preference>
  </preferences>

  <!-- CONTEXT: Temporary situational notes that affect curation.
       E.g., "Conference season", "Following specific news story" -->
  <context-notes>
  </context-notes>

  <!-- EXPERIMENTS: Ways to test what works. Start with one about calibration. -->
  <experiments>
    <experiment id="exp-initial" status="active" created-at="${now}">
      <hypothesis>Initial interests need calibration through reader feedback</hypothesis>
      <approach>Present diverse content, note what gets engagement vs gets skipped</approach>
    </experiment>
  </experiments>
</news-guide>
`;
}
