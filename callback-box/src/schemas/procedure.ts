/**
 * Procedure definition card schema (Phase-2 frontmatter, no body).
 *
 * Defines the structure of procedure definition cards in config/procedures/.
 * A procedure is a sequence of steps, each with optional precheck, run, and
 * validate phases. Each phase groups its shell commands, agent prompts,
 * instructions, and whys by kind (the engine runs them grouped, not
 * interleaved), which is why flat YAML fits.
 */

import { splitCardContent, cardSchema, type CardSchema } from "../cards/index.js";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { PROCEDURE_MODEL_NAMES } from "../shared/agent-models.js";

/** Run-expiry value: a duration like "30d"/"12w", or "never". */
const RunExpiryValue = z.union([
  z.literal("never"),
  z.string().regex(/^\d+\.?\d*\s*[dhmsw]$/, 'duration like "30d", or "never"'),
]);

/** Agent invocation through the box's configured harness, with optional tier/turn cap. */
export const ProcedureAgent = z.object({
  prompt: z.string(),
  model: z.enum(PROCEDURE_MODEL_NAMES).optional(),
  "max-turns": z.number().optional(),
});

const phaseFields = {
  shells: z.array(z.string()).optional(),
  agents: z.array(ProcedureAgent).optional(),
  instructions: z.array(z.string()).optional(),
  whys: z.array(z.string()).optional(),
};

/** Precheck phase — gates whether a step runs. */
export const ProcedurePrecheck = z.object({
  ...phaseFields,
  "pass-output": z.boolean().optional(),
});

/** Run phase — the step's main action. */
export const ProcedureRun = z.object(phaseFields);

/** Validate phase — checks results after the run. */
export const ProcedureValidate = z.object({
  ...phaseFields,
  severity: z.enum(["warn", "review", "abort"]).optional(),
  /** Model tier for `instructions:` evaluation (default: balanced). */
  model: z.enum(PROCEDURE_MODEL_NAMES).optional(),
});

/** One step. */
export const ProcedureStep = z.object({
  id: z.string(),
  description: z.string().optional(),
  precheck: ProcedurePrecheck.optional(),
  run: ProcedureRun.optional(),
  validate: ProcedureValidate.optional(),
});

const procedureFields = {
  name: z.string(),
  description: z.string().optional(),
  "run-expiry": RunExpiryValue.optional(),
  "failed-run-expiry": RunExpiryValue.optional(),
  steps: z.array(ProcedureStep),
};

export const ProcedureSchema: CardSchema = cardSchema("procedure", {
  description: "A declarative multi-step workflow definition (precheck/run/validate phases); execution state lives in procedure-run cards",
  category: "authored",
  searchable: false,
  fields: procedureFields,
  instructions: `# Handling Procedure Definitions

Procedure cards are declarative definitions — they describe WHAT should happen, not track execution. Execution state lives in a separate procedure-run card.

Don't modify a procedure card while a run is active. The engine reads the definition at run start. Changes during execution won't be picked up and may cause confusion.

Each entry in \`steps\` has optional phases: \`precheck\` (should this step run?), \`run\` (the main action), \`validate\` (did it work?). Each phase groups its actions by kind:

- \`shells:\` — a list of bash commands run in the box root. Gates a \`validate\`
  on a non-zero exit (objective check).
- \`agents:\` — a list of \`{ prompt, model?, max-turns? }\` invocations through the box's configured agent engine.
- \`instructions:\` — a list of natural-language success criteria, **model-judged**
  in a \`validate\` phase against the step's git diff. A failing verdict gates by
  the phase \`severity\` exactly like a failing \`shells:\` check. Put objective,
  cheap checks in \`shells:\`; use \`instructions:\` for judgment a shell can't make.
- \`whys:\` — a list of explanations (for humans, fixing agents, and review models);
  also handed to the instruction judge and to a \`review\` retry as context.

Use YAML block scalars (\`|\`) for multi-line shell scripts and agent prompts so indentation is preserved. \`precheck.pass-output: true\` passes precheck stdout into the run phase. \`validate.severity\` is warn (log a completed check's negative result and continue) / abort (fail the step) / review (re-invoke the run agent with the failure context to self-heal, then fail the step if it still doesn't pass — needs exactly one run agent). If the agent engine cannot produce a usable response or judge verdict at all, the step fails regardless of severity and records the engine error. \`model\` is a portable tier: \`efficient\`, \`balanced\`, \`strong\`, or \`strongest\`; the engine maps it to its own model family. Existing \`haiku\`/\`sonnet\`/\`opus\`/\`fable\` values remain aliases. \`validate.model\` defaults to \`balanced\`.

Optional \`run-expiry\` / \`failed-run-expiry\` override how long this procedure's finished run dirs are kept before \`cb procedure gc\` deletes them (defaults: 30d completed, 90d failed). Value is a duration ("60d", "12w") or "never".`,
});

const ProcedureObject = z.object(procedureFields);
export type ProcedureFields = z.infer<typeof ProcedureObject>;
export type ProcedureStepDef = z.infer<typeof ProcedureStep>;
/** Back-compat alias for the procedure-definition fields type. */
export type Procedure = ProcedureFields;

/**
 * Parse a procedure card's raw text into typed fields, or null if it has
 * no frontmatter or fails validation. Used by the engine to load a
 * definition without going through the full card loader.
 */
export function parseProcedureDefinition(content: string): ProcedureFields | null {
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return null;
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatterText);
  } catch (_e) {
    return null;
  }
  const parsed = ProcedureObject.safeParse(fm ?? {});
  if (!parsed.success) return null;
  return parsed.data;
}
