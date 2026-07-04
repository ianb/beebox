/**
 * Exposition-plan card schema — a worked process for how to *present* a subject,
 * producing a compiled set of rules.
 *
 * It is NOT a fixed lesson script. It guides the agent to (1) translate what's
 * known about the learner into concrete style implications, (2) enumerate and
 * *rate* candidate ways to present — deliberately breaking the default reach for
 * plain prose — and (3) distill the result into concrete `rules` that guide
 * later material-authoring and teaching without re-deriving. Those `rules` are
 * compiled to a path-loaded box rule (see `compileExpositionRules`) so they're
 * in context while working in the course.
 *
 * A single-file card, usually embedded in a course's attach scope. General
 * beyond courseware — any deliberate presentation could use it.
 *
 * See docs/implemented-plans/courseware-phase1.md.
 */

import { body, cardSchema, renderFrontmatterBlock, type CardSchema } from "../cards/index.js";
import { z } from "zod";

/** One candidate way to present, with an honest rating of its fit here. */
const Approach = z.object({
  approach: z.string(),       // dialog, worked example, figure/manipulative, diagram, analogy, plain prose, …
  rating: z.string(),         // honest fit + whether you'll use it ("primary", "some", "considered — rejected: too abstract here")
  why: z.string().optional(), // why it does or doesn't serve THIS material and THIS learner
});

const expositionPlanFields = {
  "learner-translation": z.array(z.string()).optional(),
  approaches: z.array(Approach).optional(),
  rules: z.array(z.string()).optional(),
  body: body(z.string()),
};

export const ExpositionPlanSchema: CardSchema = cardSchema("exposition-plan", {
  description: "A worked plan for how to present a subject — learner translation, rated approaches, and compiled presentation rules",
  category: "authored",
  fields: expositionPlanFields,
  instructions: `# Exposition-Plan Cards

An exposition-plan is a **worked process** for how to *present* a subject, and it ends in a concrete set of **rules**. It is **not** a fixed lesson script — don't pre-decide a move-by-move sequence. Its job is to produce *good, deliberate* presentation choices for *this* material and *this* learner, and to leave behind rules you can follow later without re-reasoning.

Write the card in this order — each step feeds the next:

## 1. \`learner-translation\` (do this FIRST)

Translate what's known about the learner (from the probe / progress, and whether the course is \`generic\` or for a specific person — see the course's \`audience\`) into **concrete implications for presentation style**. Not "they're rusty" but "they reason out loud and trust their own intuitions, so lead with their phenomena and let terminology stay loose." This grounds the ratings that follow.

## 2. \`approaches\` — enumerate and **rate** them

List the candidate ways to present this material, and rate each honestly for *this* material and *this* learner:

\`\`\`yaml
approaches:
  - { approach: socratic dialog, rating: primary, why: Draws out and reshapes the learner's own model }
  - { approach: a worked figure/manipulative, rating: some, why: Good for the one procedural step; overkill elsewhere }
  - { approach: plain textual exposition, rating: "considered — sparingly", why: Fine for framing, but not the spine here }
\`\`\`

**Let the concept's \`kind\` and target \`depth\` steer the first cut.** A node aimed at *understand* needs an approach that builds the model (dialog, contrasting cases), not a passive read; an *apply* node wants practice or a manipulable; a *remember* fact wants retrieval; an *analyze* principle wants contrasting cases and self-explanation. The (kind, depth) pair from the concept-map is your starting hypothesis for what fits — then rate against *this* learner.

**Why rate, not just list:** you (like anyone) reach for the familiar — and your familiar default is **textual exposition**. Force yourself off it by genuinely considering non-textual options (dialog, a figure or manipulable, a diagram, contrasting cases, an analogy) and saying why each does or doesn't fit.

**But never use a technique just because it exists.** Each one must earn its place for this subject and learner. Different domains and learners call for different techniques. **If mostly-textual is genuinely the right answer here, say so** — variety is not the goal, fit is.

## 3. \`rules\` — the compiled output

Distill the above into a short list of **concrete, standalone rules** that will guide you later — while you're authoring material or mid-conversation, focused on other things — *without* re-reading this whole card:

\`\`\`yaml
rules:
  - Open each concept from a phenomenon the learner already has; pull the idea out of it.
  - Use dialog to surface the learner's model before correcting it; never lead with a definition.
  - Reserve prose for framing and transitions, not for carrying a mechanism.
\`\`\`

These \`rules\` are **compiled to a box rule that auto-loads while you work in this course**, so write them to stand on their own. Keep the *reasoning* behind them here (and in the body); the rules themselves should be terse and actionable.

## Body

The reasoning narrative — why this shape, and how it should adapt. Living. **Use neutral pronouns (they/them) for the learner** regardless of who they are.`,
});

/**
 * Starter exposition-plan for \`cb create\`: prompts for the learner-translation
 * first, then approaches and rules. The agent fills these in.
 */
export function createExpositionPlanTemplate(options: { title?: string | undefined }): string {
  const fields: Record<string, unknown> = {
    "learner-translation": ["What's known about the learner → concrete implications for how to present."],
    rules: ["The concrete expositional rules to follow later — filled in once approaches are rated."],
  };
  if (options.title !== undefined && options.title !== "") {
    fields["title"] = options.title;
  }
  const bodyText = "The reasoning behind the presentation choices, and how it should adapt. Use neutral pronouns for the learner.\n";
  return renderFrontmatterBlock(fields, bodyText);
}
