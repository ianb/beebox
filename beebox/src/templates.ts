/**
 * Template registry - defines card templates with inspectable argument schemas.
 *
 * Each template has:
 * - A unique name
 * - A Zod schema describing its arguments
 * - A function to generate the card content
 * - Optional metadata (description, associated card types)
 *
 * The registry core lives in `templates-registry.ts`, the human-readable
 * argument inspector in `templates-describe.ts`, and the built-in template
 * definitions in `templates/`. This module declares the set (`defineRegistry`)
 * and registers every built-in template exactly once.
 */

import { defineRegistry } from "./shared/registry.js";
import { BUILTIN_TEMPLATES } from "./templates/builtins/templates.js";
import { COURSEWARE_TEMPLATES } from "./templates/courseware.js";
import { QUESTION_TEMPLATES } from "./templates/question.js";
import { SYSTEM_CARD_TEMPLATES } from "./templates/system-cards.js";
import { registerTemplate, type TemplateDefinition } from "./templates-registry.js";

const templateSources = defineRegistry<readonly TemplateDefinition[]>({
  directory: "./templates",
  entry: "templates",
  ordered: false,
  members: {
    builtins: BUILTIN_TEMPLATES,
    courseware: COURSEWARE_TEMPLATES,
    question: QUESTION_TEMPLATES,
    systemCards: SYSTEM_CARD_TEMPLATES,
  },
});

for (const group of templateSources.list) {
  for (const def of group) registerTemplate(def);
}
