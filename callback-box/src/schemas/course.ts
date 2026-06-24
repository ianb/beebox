/**
 * Course card schema — the manifest for one learning experience.
 *
 * A course is a container that binds its components: an embedded concept-map
 * (the knowledge graph) and exposition-plan (how to present it), a `material/`
 * subdirectory of presentational content, and — tracked separately per learner
 * — a progress card. Components are referenced by `ref`; the structured ones
 * (concept-map, exposition-plan) live as attached cards in the course's
 * `<basename>.attach/` scope and travel with it.
 *
 * See docs/plans/courseware-phase1.md.
 */

import { body, cardSchema, type CardSchema } from "../cards/index.js";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

/** A reference to a component card (the `ref` key is validated by card-lint). */
const ComponentRef = z.object({ ref: z.string() });

const courseFields = {
  audience: z.string().optional(),
  goals: z.array(z.string()).optional(),
  "success-criteria": z.array(z.string()).optional(),
  "concept-map": ComponentRef.optional(),
  "exposition-plan": ComponentRef.optional(),
  material: z.string().optional(),
  progress: ComponentRef.optional(),
  body: body(z.string()),
};

export const CourseSchema: CardSchema = cardSchema("course", {
  fields: courseFields,
  instructions: `# Course Cards

A course is the **manifest** for one learning experience on a bounded topic. It binds a few components, mostly by reference:

- an embedded **concept-map** (the knowledge graph) — \`{ ref: attach/<name>.concept-map.card }\`
- an embedded **exposition-plan** (how to present the material) — \`{ ref: attach/<name>.exposition-plan.card }\`
- **material** — a subdirectory of presentational cards (a path, e.g. \`attach/material\`), answer keys alongside
- **progress** — a per-learner record, tracked *separately*; it may live in the course's attach scope or in its own tree (referenced by \`ref\`)

The structured components (concept-map, exposition-plan) live as attached cards in the course's \`<basename>.attach/\` scope, so they move and validate with the course. Reuse an existing component by \`ref\` rather than duplicating it.

## Frontmatter

\`\`\`yaml
audience: a specific person — rusty on chemistry, wants a mental model   # OR: generic
goals:                          # the learner's deeper "why"; refined through probing
  - Build a working mental model of how acids and bases behave
success-criteria:               # casual, personalized "what success looks like"; set EARLY
  - Can predict whether a reaction fizzes and explain why, without naming every ion
concept-map: { ref: attach/Acids.concept-map.card }
exposition-plan: { ref: attach/Acids.exposition-plan.card }
material: attach/material        # a subdirectory of presentational cards (+ answer keys)
progress: { ref: /people/learner/Acids.progress.card }   # optional; may live elsewhere
\`\`\`

\`success-criteria\` is set **early** and is the lens for what belongs in the graph and the goals (backward design); it then judges advancement. Everything except the body is optional, so a half-built course still loads.

\`audience\` records whether this is a **generic** course (built for a model learner, reusable) or **custom** for a specific person — set it so you (and anyone reading) know which. Write the card with **neutral pronouns** (they/them) for the learner, whoever they are.

## Body

The framing: the learner's goal and motivation, the gap, and the design rationale. Living — amend it as the course adapts.`,
});

/**
 * Starter course for \`cb create\`: goal/success-criteria placeholders and a
 * framing body. Components (concept-map, exposition-plan) are added later as
 * attached cards, so the starter omits them.
 */
export function createCourseTemplate(options: { title?: string | undefined }): string {
  const fields: Record<string, unknown> = {
    goals: ["What the learner wants out of this — refined through probing."],
    "success-criteria": ["What would count as understanding this, for this learner."],
  };
  if (options.title !== undefined && options.title !== "") {
    fields["title"] = options.title;
  }
  const yamlText = stringifyYaml(fields);
  const bodyText = "Framing: the learner's goal and motivation, the gap, and the design rationale.\n";
  return `---\n${yamlText}---\n${bodyText}`;
}
