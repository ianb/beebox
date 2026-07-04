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
  "lesson-plan": ComponentRef.optional(),
  material: z.string().optional(),
  progress: ComponentRef.optional(),
  body: body(z.string()),
};

export const CourseSchema: CardSchema = cardSchema("course", {
  description: "The manifest for one learning experience — binds a concept-map, exposition-plan, lesson-plan, material, and per-learner progress",
  category: "authored",
  fields: courseFields,
  instructions: `# Course Cards

A course is the **manifest** for one learning experience on a bounded topic. It binds a few components, mostly by reference:

- an embedded **concept-map** (the knowledge graph) — \`{ ref: attach/<Course>_Concept_Map.concept-map.card }\`
- an embedded **exposition-plan** (how to present the material) — \`{ ref: attach/<Course>_Exposition_Plan.exposition-plan.card }\`
- an embedded **lesson-plan** (the ordered delivery flow — segments, live or material-backed) — \`{ ref: attach/<Course>_Lesson_Plan.lesson-plan.card }\`
- **material** — a subdirectory of presentational cards (a path, e.g. \`attach/material\`), answer keys alongside
- **progress** — a per-learner record, tracked *separately*; it may live in the course's attach scope or in its own tree (referenced by \`ref\`)

The structured components (concept-map, exposition-plan, lesson-plan) live as attached cards in the course's \`<basename>.attach/\` scope, so they move and validate with the course. Reuse an existing component by \`ref\` rather than duplicating it.

**Give each component a distinct basename** — \`<Course>_Concept_Map\`, \`<Course>_Exposition_Plan\`, \`<Course>_Lesson_Plan\`, and so on — never reuse the course's own basename for a sibling card. No two cards in the same directory may share a basename (lint error), and the course's basename is already spoken for by the attach scope itself (\`<Course>.attach/\`) and by the landmark that anchors it (\`<Course>.landmark.card\`, see the \`build-course\` skill).

## Frontmatter

\`\`\`yaml
audience: a specific person — rusty on chemistry, wants a mental model   # OR: generic
goals:                          # the learner's deeper "why"; refined through probing
  - Build a working mental model of how acids and bases behave
success-criteria:               # casual, personalized "what success looks like"; set EARLY
  - Can predict whether a reaction fizzes and explain why, without naming every ion
concept-map: { ref: attach/Acids_Bases_Concept_Map.concept-map.card }
exposition-plan: { ref: attach/Acids_Bases_Exposition_Plan.exposition-plan.card }
lesson-plan: { ref: attach/Acids_Bases_Lesson_Plan.lesson-plan.card }
material: attach/material        # a subdirectory of presentational cards (+ answer keys)
progress: { ref: /people/learner/Acids_Bases_Progress.progress.card }   # optional; may live elsewhere
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
