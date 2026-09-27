/**
 * Courseware template definitions (concept-map, course, exposition-plan,
 * lesson-plan, progress). A plain array; `../templates.ts` registers each
 * member into the shared registry. Kept in its own file so the builtins
 * catalogue stays under the line limit and the courseware family reads
 * together.
 */

import { z } from "zod";
import { eraseTemplateArgs, type TemplateDefinition } from "../templates-registry.js";
import { createConceptMapTemplate } from "../schemas/concept-map.js";
import { createCourseTemplate } from "../schemas/course.js";
import { createExpositionPlanTemplate } from "../schemas/exposition-plan.js";
import { createLessonPlanTemplate } from "../schemas/lesson-plan.js";
import { createProgressTemplate } from "../schemas/progress.js";

const titleArgs = z.object({ title: z.string().optional().describe("Display title") });

export const COURSEWARE_TEMPLATES: TemplateDefinition[] = [
  eraseTemplateArgs({
    name: "concept-map",
    description: "A module-scale knowledge graph (concepts as in-card nodes with typed edges)",
    cardTypes: ["concept-map"],
    defaultForTypes: ["concept-map"],
    argsSchema: titleArgs,
    generate: (args) => createConceptMapTemplate({ title: args.title }),
  }),

  eraseTemplateArgs({
    name: "course",
    description: "A learning-experience manifest (binds a concept-map, exposition-plan, material, and progress)",
    cardTypes: ["course"],
    defaultForTypes: ["course"],
    argsSchema: titleArgs,
    generate: (args) => createCourseTemplate({ title: args.title }),
  }),

  eraseTemplateArgs({
    name: "exposition-plan",
    description: "A plan for how to present a subject (modalities + decisions, with the reasoning kept in)",
    cardTypes: ["exposition-plan"],
    defaultForTypes: ["exposition-plan"],
    argsSchema: titleArgs,
    generate: (args) => createExpositionPlanTemplate({ title: args.title }),
  }),

  eraseTemplateArgs({
    name: "lesson-plan",
    description: "An ordered delivery flow (segments tagged interactive vs material, tied to the concept-map)",
    cardTypes: ["lesson-plan"],
    defaultForTypes: ["lesson-plan"],
    argsSchema: titleArgs,
    generate: (args) => createLessonPlanTemplate({ title: args.title }),
  }),

  eraseTemplateArgs({
    name: "progress",
    description: "A per-learner, evidence-backed record of understanding against a course's concept-map",
    cardTypes: ["progress"],
    defaultForTypes: ["progress"],
    argsSchema: titleArgs,
    generate: (args) => createProgressTemplate({ title: args.title }),
  }),
];
