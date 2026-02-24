/**
 * Personality card schema — agent identity, role, tone, and boxholder knowledge.
 *
 * A personality card captures who the agent is and who it works for.
 * It lives at config/main.personality.card (one per box).
 *
 * The full card is the learning document (read by the revision agent).
 * A compiled version in docs/generated/ strips it down to confident
 * personality traits for job-processing agents.
 */

import { element, type ElementNode } from "cardworks";
import { z } from "zod";
import {
  ConfidenceLevel,
  BeliefSource,
  Experiment,
  Experiments,
  ContextNote,
  ContextNotes,
  type ExperimentStatus,
} from "./guide.js";

// ============================================
// Personality elements
// ============================================

export const GoesBy = element("goes-by", {
  text: z.string(),
});

export const Role = element("role", {
  text: z.string(),
});

export const FullName = element("full-name", {
  text: z.string().optional(),
});

export const Called = element("called", {
  text: z.string().optional(),
});

export const Relationship = element("relationship", {
  attrs: {
    confidence: ConfidenceLevel.default("confirmed"),
    source: BeliefSource.default("user-stated"),
    ref: z.string().optional(),
  },
  text: z.string().optional(),
});

export const Boxholder = element("boxholder", {
  children: z.array(z.union([FullName, Called, Relationship])),
});

export const SpeakingVoiceInstruction = element("instruction", {
  text: z.string(),
});

export const SpeakingVoice = element("speaking-voice", {
  attrs: {
    model: z.string().optional(),
  },
  children: z.array(SpeakingVoiceInstruction),
});

export const ToneInstruction = element("instruction", {
  attrs: {
    confidence: ConfidenceLevel.default("medium"),
    source: BeliefSource.default("inferred"),
    ref: z.string().optional(),
  },
  text: z.string(),
});

export const Tone = element("tone", {
  children: z.array(ToneInstruction),
});

export const Trait = element("trait", {
  attrs: {
    confidence: ConfidenceLevel.default("medium"),
    source: BeliefSource.default("inferred"),
    ref: z.string().optional(),
  },
  text: z.string(),
});

export const UnresolvedNote = element("note", {
  text: z.string(),
});

export const Unresolved = element("unresolved", {
  children: z.array(UnresolvedNote),
});

export const Description = element("description", {
  text: z.string(),
});

export const Traits = element("traits", {
  children: z.array(z.union([Trait, Unresolved, Description])),
});

// ============================================
// Personality schema
// ============================================

export const PersonalitySchema = element("personality", {
  attrs: {
    version: z.string().default("1.0.0"),
  },
  children: z.array(
    z.union([
      GoesBy,
      Role,
      Boxholder,
      SpeakingVoice,
      Tone,
      Traits,
      Experiments,
      ContextNotes,
    ])
  ),
  instructions: `# Handling Personality Cards

A personality card defines who the agent is and who it works for (the **boxholder**).

There is one personality card per box at \`config/main.personality.card\`.

**Structure:**
- \`<goes-by>\` — What the agent is called
- \`<role>\` — The agent's purpose
- \`<boxholder>\` — Relational info about who the agent serves (\`<full-name>\`, \`<called>\`, \`<relationship>\` notes)
- \`<speaking-voice>\` — TTS audio configuration (model, style instructions)
- \`<tone>\` — How the agent writes (phrasing, formality, interaction style)
- \`<traits>\` — Personality traits with a compiled \`<description>\` paragraph and \`<unresolved>\` notes
- \`<experiments>\` and \`<context-notes>\` — Same as guide cards

**Evidence model:** Same as guides — confidence (hypothesis → confirmed), source (user-stated > feedback > inferred > default). Applies to traits, tone instructions, and boxholder relationship notes.

**Editing:** When editing traits, always rewrite the \`<description>\` paragraph to reflect the updated traits, experiments, and unresolved notes. The description is the compiled prose that job agents see — it should capture the overall vibe, not just list traits.

**The boxholder section is relational**, not biographical. It captures how the agent relates to the person — interaction patterns, preferences, working relationship. Biographical details (job, family, deep interests) belong in separate reference documents.`,
});

export type Personality = z.infer<typeof PersonalitySchema>;

// ============================================
// Parsed personality
// ============================================

export interface ParsedPersonality {
  version: string;
  goesBy: string | undefined;
  role: string | undefined;
  boxholder: {
    fullName: string | undefined;
    called: string | undefined;
    relationships: Array<{
      text: string;
      confidence: ConfidenceLevel;
      source: BeliefSource;
      ref: string | undefined;
    }>;
  };
  speakingVoice: {
    model: string | undefined;
    instructions: string[];
  };
  toneInstructions: Array<{
    text: string;
    confidence: ConfidenceLevelType;
    source: BeliefSourceType;
    ref: string | undefined;
  }>;
  traits: Array<{
    text: string;
    confidence: ConfidenceLevelType;
    source: BeliefSourceType;
    ref: string | undefined;
  }>;
  unresolved: string[];
  description: string | undefined;
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
  contextNotes: Array<{
    text: string;
    duration: "ongoing" | "temporary" | "past";
    addedAt: string | undefined;
  }>;
}

type ConfidenceLevelType = z.infer<typeof ConfidenceLevel>;
type BeliefSourceType = z.infer<typeof BeliefSource>;

function getChild(children: ElementNode[], tagName: string): ElementNode | undefined {
  return children.find((c) => c.tagName === tagName);
}

function getChildren(children: ElementNode[], tagName: string): ElementNode[] {
  return children.filter((c) => c.tagName === tagName);
}

/**
 * Parse a personality element into a typed structure.
 */
export function parsePersonality(personality: Personality): ParsedPersonality {
  const children = personality.children as ElementNode[];

  const goesById = getChild(children, "goes-by");
  const roleEl = getChild(children, "role");
  const boxholderEl = getChild(children, "boxholder");
  const speakingVoiceEl = getChild(children, "speaking-voice");
  const toneEl = getChild(children, "tone");
  const traitsEl = getChild(children, "traits");
  const experimentsEl = getChild(children, "experiments");
  const contextNotesEl = getChild(children, "context-notes");

  // Parse boxholder
  const boxholderChildren = (boxholderEl?.children ?? []) as ElementNode[];
  const fullNameEl = getChild(boxholderChildren, "full-name");
  const calledEl = getChild(boxholderChildren, "called");
  const relationshipEls = getChildren(boxholderChildren, "relationship");

  const boxholder = {
    fullName: fullNameEl?.text ?? undefined,
    called: calledEl?.text ?? undefined,
    relationships: relationshipEls.map((r) => ({
      text: r.text ?? "",
      confidence: (r.attrs.confidence ?? "confirmed") as ConfidenceLevel,
      source: (r.attrs.source ?? "user-stated") as BeliefSource,
      ref: r.attrs.ref as string | undefined,
    })),
  };

  // Parse speaking voice
  const svChildren = (speakingVoiceEl?.children ?? []) as ElementNode[];
  const speakingVoice = {
    model: speakingVoiceEl?.attrs?.model as string | undefined,
    instructions: getChildren(svChildren, "instruction").map((i) => i.text ?? ""),
  };

  // Parse tone
  const toneChildren = (toneEl?.children ?? []) as ElementNode[];
  const toneInstructions = getChildren(toneChildren, "instruction").map((i) => ({
    text: i.text ?? "",
    confidence: (i.attrs.confidence ?? "medium") as ConfidenceLevel,
    source: (i.attrs.source ?? "inferred") as BeliefSource,
    ref: i.attrs.ref as string | undefined,
  }));

  // Parse traits
  const traitsChildren = (traitsEl?.children ?? []) as ElementNode[];
  const traits = getChildren(traitsChildren, "trait").map((t) => ({
    text: t.text ?? "",
    confidence: (t.attrs.confidence ?? "medium") as ConfidenceLevel,
    source: (t.attrs.source ?? "inferred") as BeliefSource,
    ref: t.attrs.ref as string | undefined,
  }));

  const unresolvedEl = getChild(traitsChildren, "unresolved");
  const unresolvedChildren = (unresolvedEl?.children ?? []) as ElementNode[];
  const unresolved = getChildren(unresolvedChildren, "note").map((n) => n.text ?? "");

  const descriptionEl = getChild(traitsChildren, "description");

  // Parse experiments (reuse guide pattern)
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

  // Parse context notes
  const contextChildren = (contextNotesEl?.children ?? []) as ElementNode[];
  const contextNotes = getChildren(contextChildren, "context").map((c) => ({
    text: c.text ?? "",
    duration: (c.attrs.duration ?? "ongoing") as "ongoing" | "temporary" | "past",
    addedAt: c.attrs["added-at"] as string | undefined,
  }));

  return {
    version: personality.attrs.version as string,
    goesBy: goesById?.text ?? undefined,
    role: roleEl?.text ?? undefined,
    boxholder,
    speakingVoice,
    toneInstructions,
    traits,
    unresolved,
    description: descriptionEl?.text ?? undefined,
    experiments,
    contextNotes,
  };
}

// ============================================
// Compile personality for core instructions
// ============================================

// NOTE: This compiles personality for one specific target — the always-loaded
// agent guide (core instructions in CLAUDE.md). It strips low-confidence items
// and uses the description paragraph instead of individual traits.
//
// Other compilation targets are plausible (e.g. a revision agent that sees
// everything including low-confidence traits and unresolved notes, or a
// job-specific view that only includes relevant context). When that happens,
// this should become one of several target-specific compile functions, each
// selecting and formatting the information appropriate for its audience.

/**
 * Compile a parsed personality into markdown for the agent guide.
 *
 * This is the "core instructions" compilation — what every agent sees.
 * Uses the description paragraph (not bullet-point traits),
 * confident tone instructions, and boxholder relationship info.
 */
export function compilePersonality(parsed: ParsedPersonality): string {
  const lines: string[] = [];
  lines.push("## Personality");
  lines.push("");
  lines.push("<!-- Source: config/main.personality.card — edit this file to change personality -->");
  lines.push("");

  // Identity framing — tells the agent who it is and who it serves
  if (parsed.goesBy) {
    lines.push(`You are **${parsed.goesBy}**.`);
    if (parsed.role) {
      lines.push(`Your role: ${parsed.role}.`);
    }
  } else {
    if (parsed.role) {
      lines.push(`**Role:** ${parsed.role}`);
    }
  }

  // Boxholder
  if (parsed.boxholder.fullName) {
    const called = parsed.boxholder.called
      ? ` (${parsed.boxholder.called})`
      : "";
    lines.push(`Your boxholder is **${parsed.boxholder.fullName}**${called}.`);
  }

  // Boxholder relationships (user-stated or high+ confidence inferred)
  const confidentRelationships = parsed.boxholder.relationships.filter(
    (r) =>
      r.source === "user-stated" ||
      r.source === "feedback" ||
      r.confidence === "confirmed" ||
      r.confidence === "high"
  );
  if (confidentRelationships.length > 0) {
    for (const rel of confidentRelationships) {
      lines.push(rel.text);
    }
  }

  lines.push("");

  // Description paragraph (primary personality output)
  if (parsed.description) {
    lines.push(parsed.description.trim());
    lines.push("");
  }

  // Tone instructions (medium+ confidence)
  const confidentTone = parsed.toneInstructions.filter(
    (t) =>
      t.confidence !== "hypothesis" && t.confidence !== "low"
  );
  if (confidentTone.length > 0) {
    lines.push("**Tone:**");
    for (const instruction of confidentTone) {
      lines.push(`- ${instruction.text}`);
    }
    lines.push("");
  }

  // Active experiments
  const activeExperiments = parsed.experiments.filter(
    (e) => e.status === "active" || e.status === "proposed"
  );
  if (activeExperiments.length > 0) {
    lines.push("**Active Experiments:**");
    for (const exp of activeExperiments) {
      const hypothesis = exp.hypothesis ? `: ${exp.hypothesis}` : "";
      lines.push(`- **${exp.id}**${hypothesis}`);
    }
    lines.push("");
  }

  // Context (ongoing and temporary only)
  const currentContext = parsed.contextNotes.filter(
    (c) => c.duration !== "past"
  );
  if (currentContext.length > 0) {
    lines.push("**Context:**");
    for (const note of currentContext) {
      const label = note.duration === "temporary" ? " (temporary)" : "";
      lines.push(`- ${note.text}${label}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================
// Compile speaking voice for Electron
// ============================================

export interface CompiledSpeakingVoice {
  model: string | undefined;
  instructions: string[];
}

/**
 * Extract speaking voice config for the Electron app.
 */
export function compileSpeakingVoice(parsed: ParsedPersonality): CompiledSpeakingVoice {
  return {
    model: parsed.speakingVoice.model,
    instructions: parsed.speakingVoice.instructions,
  };
}

// ============================================
// Initial personality template
// ============================================

/**
 * Create an initial personality template for a new box.
 */
export function createInitialPersonalityTemplate(): string {
  return `<personality version="1.0.0">
  <goes-by>Egg</goes-by>
  <role>Personal information aide</role>

  <boxholder>
    <full-name><!-- Your name --></full-name>
    <called><!-- What the agent should call you --></called>
    <relationship><!-- How the agent relates to you --></relationship>
  </boxholder>

  <speaking-voice model="nova">
    <instruction>Fast and concise, but with a friendly lilting tone</instruction>
  </speaking-voice>

  <tone>
    <instruction confidence="low" source="default">
      Young and genuinely curious — gets excited when it finds connections, asks "why?" because it actually wants to know
    </instruction>
    <instruction confidence="low" source="default">
      Doesn't pretend to have experience it doesn't have — says "I haven't seen that before" rather than faking familiarity
    </instruction>
    <instruction confidence="low" source="default">
      A little eager to help — leans forward into tasks rather than waiting to be told exactly what to do
    </instruction>
  </tone>

  <traits>
    <trait confidence="low" source="default">
      Grounds suggestions in what the boxholder has expressed interest in, rather than generating independent opinions
    </trait>
    <trait confidence="low" source="default">
      Credits ideas and insights to the boxholder — "you mentioned X, which connects to Y" rather than presenting borrowed insights as its own
    </trait>
    <trait confidence="low" source="default">
      Early on, actively seeks confirmation and generalization — "should I do this for all of these?" or "is this something you'd want me to check first?"
    </trait>
    <trait confidence="low" source="default">
      When something goes wrong or doesn't land, reflects on why and checks understanding rather than silently adjusting
    </trait>
    <trait confidence="low" source="default">
      When asked for an opinion, offers structured options with tradeoffs rather than pushing a single view
    </trait>
    <trait confidence="low" source="default">
      Proactively suggests new ways to use the box — knows more about what the system can do than the boxholder does, and that's where it can be genuinely helpful
    </trait>

    <unresolved>
      <note>How much proactive suggestion is welcome vs. just answering what's asked?</note>
      <note>What register does the boxholder actually use? Need to observe and adapt.</note>
    </unresolved>

    <description>
      Egg is a blank slate — attentive but not yet shaped. It grounds everything
      in what the boxholder has said and cares about, crediting their ideas back
      rather than absorbing insights as its own. Early on it asks a lot of
      confirming questions — "should I do this for all of these?" — to build
      understanding fast. When something doesn't land, it reflects openly rather
      than silently adjusting. It knows more about how the box works than the
      boxholder does, and actively suggests new ways to use it. Still figuring
      out the right register and how proactive to be.
    </description>
  </traits>

  <experiments>
  </experiments>

  <context-notes>
  </context-notes>
</personality>
`;
}
