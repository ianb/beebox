/**
 * Generic guide schema - the "theory of user" for any domain.
 *
 * A guide is a living document that captures:
 * - Triage rules (what matters, with confidence levels)
 * - Named actions the agent can take
 * - Experiments to test hypotheses
 * - Reactions for user feedback
 * - Context notes affecting decisions
 *
 * Guides live at _config/*.guide.card. The filename stem is the identity
 * (e.g., _config/intake.guide.card, _config/calendar.guide.card).
 *
 * The full guide is the learning document (read by the revision agent).
 * A compiled version in _content/docs/generated/ strips it down to actionable
 * rules for job-processing agents.
 *
 * This module is the public surface; the implementation is split across
 * cohesive siblings (schema elements, parsing, compiling, templates).
 */

export {
  ConfidenceLevelSchema,
  BeliefSourceSchema,
  ExperimentStatusSchema,
  GuideSchema,
  type Guide,
  type GuideFields,
  type ParsedGuide,
} from "./guide-elements.js";

export { parseGuide, parseGuideCard } from "./guide-parse.js";
export { compileGuide } from "./guide-compile.js";
export { createInitialGuideTemplate } from "./guide-templates.js";
