/**
 * Template registry - defines card templates with inspectable argument schemas.
 *
 * Each template has:
 * - A unique name
 * - A Zod schema describing its arguments
 * - A function to generate the card content
 * - Optional metadata (description, associated card types)
 *
 * This module declares the set of built-in template groups (`defineRegistry`)
 * as plain data — no registration side effect. `templates-registry.ts` (the
 * store) imports `templateGroups` from here and registers every member at
 * its own module load, so importing any lookup (`getTemplate`, etc.) is what
 * loads the built-ins; nothing needs a bare side-effect import of this file.
 * This module and the built-in group files under `templates/` depend on the
 * leaf module `templates-shape.ts` for `TemplateDefinition`/
 * `eraseTemplateArgs`, never on `templates-registry.ts` itself, so the store
 * can depend on this module without the two forming a value import cycle.
 * The human-readable argument inspector lives in `templates-describe.ts`.
 */

import { defineRegistry } from "./shared/registry.js";
import { BUILTIN_TEMPLATES } from "./templates/builtins/templates.js";
import { COURSEWARE_TEMPLATES } from "./templates/courseware.js";
import { QUESTION_TEMPLATES } from "./templates/question.js";
import { SYSTEM_CARD_TEMPLATES } from "./templates/system-cards.js";
import type { TemplateDefinition } from "./templates-shape.js";

export const templateGroups = defineRegistry<readonly TemplateDefinition[]>({
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
