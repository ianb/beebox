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

import { body, cardSchema, type CardSchema } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import {
  ConfidenceLevel,
  BeliefSource,
  ExperimentStatus,
} from "./guide.js";

type ConfidenceLevelType = z.infer<typeof ConfidenceLevel>;
type BeliefSourceType = z.infer<typeof BeliefSource>;
type ExperimentStatusType = z.infer<typeof ExperimentStatus>;

const RelationshipEntry = z.object({
  text: z.string(),
  confidence: ConfidenceLevel.default("confirmed"),
  source: BeliefSource.default("user-stated"),
  ref: z.string().optional(),
});

const BoxholderEntry = z.object({
  "full-name": z.string().optional(),
  called: z.string().optional(),
  relationships: z.array(RelationshipEntry).optional(),
});

const SpeakingVoiceEntry = z.object({
  model: z.string().optional(),
  instructions: z.array(z.string()).optional(),
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
  instructions: `# Handling Personality Cards

A personality card defines the agent's **voice and manner** — how it
communicates, not what the box is about.

There is one personality card per box at
\`config/main.personality.card\`.

**This card is about communication style ONLY.** Do NOT put situational
context here. The box's purpose, key people, and essential facts belong
in the briefing card (\`briefing.briefing.card\`). The personality card
answers "how should I talk?" — the briefing card answers "what am I
working on?"

## Frontmatter

- \`goes-by:\` — What the agent is called
- \`role:\` — The agent's general function (e.g., "Personal information
  aide"). About what the agent *does*, not what the box contains.
- \`boxholder:\` — \`{full-name?, called?, relationships?}\`. Relational
  info about who the agent serves. Each relationship is
  \`{text, confidence?, source?, ref?}\`.
- \`speaking-voice:\` — \`{model?, instructions?}\` for TTS in the chat
  frontend (see below).
- \`tone:\` — array of \`{text, confidence?, source?, ref?}\` —
  instructions about how the agent writes (phrasing, formality,
  interaction style).
- \`traits:\` — array of \`{text, confidence?, source?, ref?}\` —
  personality traits.
- \`unresolved:\` — array of free-form notes about open questions.
- \`experiments:\` and \`context-notes:\` — same shape as guide cards.

## Body (markdown)

The compiled "description" paragraph — prose that captures the overall
vibe. When editing traits, **always rewrite the body** to reflect the
updated traits, experiments, and unresolved notes. The body is what
job agents see; it should capture the overall vibe, not just list
traits.

## Speaking voice

The \`speaking-voice\` field configures the chat TTS voice. Applies
only to the chat frontend — jobs, procedures, and other agents don't
use TTS. The \`model\` picks one of 13 OpenAI voices (impressions are
subjective; experiment to find a fit):

- \`alloy\` — Low female voice, somewhat older/mature, perhaps Black
- \`ash\` — Deep male voice, somewhat gravelly
- \`ballad\` — British male voice, high pitched, younger/peppy
- \`cedar\` — Male, medium, glitchy but engaged
- \`coral\` — Female, medium, enthusiastic but with an impersonal affect
- \`echo\` — Neutral, could be male or female, naive
- \`fable\` — British female voice, upper class, posh
- \`marin\` — Female, medium, glitchy but very personal, younger feeling (default)
- \`onyx\` — Male, low, deep and smooth, perhaps Black
- \`nova\` — Female, high, engaged and personal
- \`sage\` — Female, high, perky and light
- \`shimmer\` — Female, medium, direct and personable
- \`verse\` — Male, medium, smooth and professional, perhaps impersonal

\`instructions\` is an array of style guidance — affect, tone, pacing,
emotion, pronunciation. These apply to every spoken response. Keep
instructions sensory and specific ("Warm and unhurried, with a slight
lilt; pause briefly before names") rather than abstract ("be friendly").

## Evidence model

Same as guides — confidence (hypothesis → confirmed), source
(user-stated > feedback > inferred > default). Applies to traits, tone
instructions, and boxholder relationship notes.

## Boxholder section is relational

Not biographical. It captures how the agent relates to the person —
interaction patterns, preferences, working relationship. Biographical
details (job, family, deep interests) belong in person cards
(\`people/First_Last.person.card\`) or the briefing card.`,
});

export interface PersonalityFields {
  type: "personality";
  version: string;
  "goes-by"?: string;
  role?: string;
  boxholder?: {
    "full-name"?: string;
    called?: string;
    relationships?: Array<{
      text: string;
      confidence?: ConfidenceLevelType;
      source?: BeliefSourceType;
      ref?: string;
    }>;
  };
  "speaking-voice"?: {
    model?: string;
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

  // Identity framing
  if (fields["goes-by"] !== undefined && fields["goes-by"] !== "") {
    lines.push(`You are **${fields["goes-by"]}**.`);
    if (fields.role !== undefined && fields.role !== "") {
      lines.push(`Your role: ${fields.role}.`);
    }
  } else if (fields.role !== undefined && fields.role !== "") {
    lines.push(`**Role:** ${fields.role}`);
  }

  // Boxholder
  const boxholder = fields.boxholder ?? {};
  if (boxholder["full-name"] !== undefined && boxholder["full-name"] !== "") {
    const called = boxholder.called !== undefined && boxholder.called !== ""
      ? ` (${boxholder.called})`
      : "";
    lines.push(`Your boxholder is **${boxholder["full-name"]}**${called}.`);
  }
  const confidentRelationships = (boxholder.relationships ?? []).filter(
    (r) => (r.confidence ?? "confirmed") !== "hypothesis",
  );
  for (const rel of confidentRelationships) {
    lines.push(rel.text);
  }

  lines.push("");

  // Description (body) — primary personality output
  const description = fields.body.trim();
  if (description !== "") {
    lines.push(description);
    lines.push("");
  }

  // Tone instructions (anything above hypothesis)
  const confidentTone = (fields.tone ?? []).filter(
    (t) => (t.confidence ?? "medium") !== "hypothesis",
  );
  if (confidentTone.length > 0) {
    lines.push("**Tone:**");
    for (const instruction of confidentTone) {
      lines.push(`- ${instruction.text}`);
    }
    lines.push("");
  }

  // Speaking voice
  const sv = fields["speaking-voice"];
  if (sv !== undefined && (sv.model !== undefined || (sv.instructions ?? []).length > 0)) {
    lines.push("**Speaking Voice:**");
    if (sv.model !== undefined) lines.push(`- Voice model: ${sv.model}`);
    for (const instruction of sv.instructions ?? []) {
      lines.push(`- ${instruction}`);
    }
    lines.push("- Edit `speaking-voice` in `config/main.personality.card` to change defaults");
    lines.push("- For per-message voice or instruction overrides (chat only), see `docs/generated/chat-voice.md`");
    lines.push("");
  }

  // Active experiments
  const activeExperiments = (fields.experiments ?? []).filter(
    (e) => (e.status ?? "proposed") === "active" || (e.status ?? "proposed") === "proposed",
  );
  if (activeExperiments.length > 0) {
    lines.push("**Active Experiments:**");
    for (const exp of activeExperiments) {
      const hypothesis = exp.hypothesis !== undefined ? `: ${exp.hypothesis}` : "";
      lines.push(`- **${exp.id}**${hypothesis}`);
    }
    lines.push("");
  }

  // Context (ongoing and temporary only)
  const currentContext = (fields["context-notes"] ?? []).filter(
    (c) => (c.duration ?? "ongoing") !== "past",
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

export interface CompiledSpeakingVoice {
  model: string | undefined;
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

/**
 * Create an initial personality template for a new box.
 */
export function createInitialPersonalityTemplate(): string {
  const fields: Record<string, unknown> = {
    type: "personality",
    version: "1.0.0",
    "goes-by": "Egg",
    role: "Personal information aide",
    boxholder: {
      "full-name": "",
      called: "",
      relationships: [],
    },
    "speaking-voice": {
      model: "nova",
      instructions: ["Fast and concise, but with a friendly lilting tone"],
    },
    tone: [
      {
        text: "Young and genuinely curious — gets excited when it finds connections, asks \"why?\" because it actually wants to know",
        confidence: "low",
        source: "default",
      },
      {
        text: "Doesn't pretend to have experience it doesn't have — says \"I haven't seen that before\" rather than faking familiarity",
        confidence: "low",
        source: "default",
      },
      {
        text: "A little eager to help — leans forward into tasks rather than waiting to be told exactly what to do",
        confidence: "low",
        source: "default",
      },
    ],
    traits: [
      {
        text: "Grounds suggestions in what the boxholder has expressed interest in, rather than generating independent opinions",
        confidence: "low",
        source: "default",
      },
      {
        text: "Credits ideas and insights to the boxholder — \"you mentioned X, which connects to Y\" rather than presenting borrowed insights as its own",
        confidence: "low",
        source: "default",
      },
      {
        text: "Early on, actively seeks confirmation and generalization — \"should I do this for all of these?\" or \"is this something you'd want me to check first?\"",
        confidence: "low",
        source: "default",
      },
      {
        text: "When something goes wrong or doesn't land, reflects on why and checks understanding rather than silently adjusting",
        confidence: "low",
        source: "default",
      },
      {
        text: "When asked for an opinion, offers structured options with tradeoffs rather than pushing a single view",
        confidence: "low",
        source: "default",
      },
      {
        text: "Proactively suggests new ways to use the box — knows more about what the system can do than the boxholder does, and that's where it can be genuinely helpful",
        confidence: "low",
        source: "default",
      },
    ],
    unresolved: [
      "How much proactive suggestion is welcome vs. just answering what's asked?",
      "What register does the boxholder actually use? Need to observe and adapt.",
    ],
  };
  const body = "Egg is a blank slate — attentive but not yet shaped. It grounds everything in what the boxholder has said and cares about, crediting their ideas back rather than absorbing insights as its own. Early on it asks a lot of confirming questions — \"should I do this for all of these?\" — to build understanding fast. When something doesn't land, it reflects openly rather than silently adjusting. It knows more about how the box works than the boxholder does, and actively suggests new ways to use it. Still figuring out the right register and how proactive to be.\n";
  return `---\n${stringifyYaml(fields)}---\n${body}`;
}
