/**
 * Courseware template registrations (concept-map, course, exposition-plan,
 * progress). Imported for its side effects, like templates-builtins.ts — kept in
 * its own file so the builtins catalogue stays under the line limit and the
 * courseware family reads together.
 */

import { z } from "zod";
import { createConceptMapTemplate } from "./concept-map.js";
import { createCourseTemplate } from "./course.js";
import { createExpositionPlanTemplate } from "./exposition-plan.js";
import { createProgressTemplate } from "./progress.js";
import { registerTemplate } from "./templates-registry.js";

const titleArgs = z.object({ title: z.string().optional().describe("Display title") });

registerTemplate({
  name: "concept-map",
  description: "A module-scale knowledge graph (concepts as in-card nodes with typed edges)",
  cardTypes: ["concept-map"],
  defaultForTypes: ["concept-map"],
  argsSchema: titleArgs,
  generate: (args) => createConceptMapTemplate({ title: args.title }),
});

registerTemplate({
  name: "course",
  description: "A learning-experience manifest (binds a concept-map, exposition-plan, material, and progress)",
  cardTypes: ["course"],
  defaultForTypes: ["course"],
  argsSchema: titleArgs,
  generate: (args) => createCourseTemplate({ title: args.title }),
});

registerTemplate({
  name: "exposition-plan",
  description: "A plan for how to present a subject (modalities + decisions, with the reasoning kept in)",
  cardTypes: ["exposition-plan"],
  defaultForTypes: ["exposition-plan"],
  argsSchema: titleArgs,
  generate: (args) => createExpositionPlanTemplate({ title: args.title }),
});

registerTemplate({
  name: "progress",
  description: "A per-learner, evidence-backed record of understanding against a course's concept-map",
  cardTypes: ["progress"],
  defaultForTypes: ["progress"],
  argsSchema: titleArgs,
  generate: (args) => createProgressTemplate({ title: args.title }),
});
