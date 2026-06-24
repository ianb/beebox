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
 * definitions in `templates-builtins.ts`. Importing this module registers all
 * built-in templates as a side effect and re-exports the public API.
 */

// Side-effect import: registers all built-in templates into the registry.
import "./templates-builtins.js";
import "./templates-courseware.js";

export {
  type TemplateDefinition,
  registerTemplate,
  getTemplate,
  getTemplateNames,
  getAllTemplates,
  getTemplatesForCardType,
  getDefaultTemplate,
} from "./templates-registry.js";

export { describeTemplateArgs } from "./templates-describe.js";
