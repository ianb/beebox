/**
 * Exposition-plan card schema — the plan for how to *present* a subject.
 *
 * Plans all aspects of the exposition, reasoned from the goals, what's known
 * about the learner/audience, and the available ways a thing can be presented
 * (modalities), with the *reasoning kept in* so later adaptation stays coherent.
 * It is the PLAN, not the rendered exposition — that lives in a course's
 * `material/`. A single-file card, usually embedded in a course's attach scope.
 *
 * General beyond courseware: any deliberate presentation (slides, a blog post)
 * could use it.
 *
 * See docs/plans/courseware-phase1.md.
 */

import { body, cardSchema, type CardSchema } from "../cards/index.js";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

/** A chosen way to present (manipulatives, dialogs, worked examples, …) + why. */
const Modality = z.object({
  name: z.string(),
  why: z.string().optional(),
});

/** A pedagogical decision with its rationale, so adaptation respects the why. */
const Decision = z.object({
  decision: z.string(),
  rationale: z.string(),
});

const expositionPlanFields = {
  emphasis: z.array(z.string()).optional(),
  modalities: z.array(Modality).optional(),
  decisions: z.array(Decision).optional(),
  body: body(z.string()),
};

export const ExpositionPlanSchema: CardSchema = cardSchema("exposition-plan", {
  fields: expositionPlanFields,
  instructions: `# Exposition-Plan Cards

An exposition-plan is the plan for how to **present** a subject — *all* aspects of the exposition, reasoned from the goals, what's known about the learner/audience, and the available ways a thing can be presented (modalities). It is the **plan**, not the rendered exposition (that lives in a course's \`material/\`). Usually a single-file card embedded in a course's \`<basename>.attach/\` scope. (General beyond courseware — slides, a blog post, etc.)

**Keep the reasoning in.** Each decision carries its rationale, so when the plan is adapted later the *why* travels with it. Adapt the plan in place; don't overwrite the reasoning.

## Frontmatter

\`\`\`yaml
emphasis:                       # the weighting that follows from the learner's goal
  - Principles over terminology — the mechanism matters, the names don't
modalities:                     # the chosen ways to present, each with a why
  - { name: dialog, why: Draws out the learner's own model and misconceptions }
  - { name: worked example + fading, why: Builds the procedure, then removes scaffolds }
decisions:                      # decisions WITH rationale (so adaptation stays coherent)
  - { decision: Open with the baking-soda phenomenon, rationale: Concrete and familiar; surfaces priors }
\`\`\`

Consider transfer prompts and a metacognitive-reflection step among the modalities. Everything except the body is optional.

## Body

The plan narrative and its reasoning — living, adapted in place.`,
});

/**
 * Starter exposition-plan for \`cb create\`: an emphasis placeholder and a
 * framing body. The agent fills in modalities and decisions as the plan forms.
 */
export function createExpositionPlanTemplate(options: { title?: string | undefined }): string {
  const fields: Record<string, unknown> = {
    emphasis: ["What to weight for this learner — e.g. principles over terminology."],
  };
  if (options.title !== undefined && options.title !== "") {
    fields["title"] = options.title;
  }
  const yamlText = stringifyYaml(fields);
  const bodyText = "The plan for presenting this subject, and the reasoning behind it. Keep the reasoning in.\n";
  return `---\n${yamlText}---\n${bodyText}`;
}
