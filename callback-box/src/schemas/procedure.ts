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

/** Run-expiry value: a duration like "30d"/"12w", or "never". */
const RunExpiryValue = z.union([
  z.literal("never"),
  z.string().regex(/^\d+\.?\d*\s*[dhmsw]$/, 'duration like "30d", or "never"'),
]);

/** Agent invocation: a Claude Code prompt with optional model/turn cap. */
export const ProcedureAgent = z.object({
  prompt: z.string(),
  model: z.enum(["haiku", "sonnet", "opus"]).optional(),
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
  searchable: false,
  fields: procedureFields,
  instructions: `# Handling Procedure Definitions

Procedure cards are declarative definitions — they describe WHAT should happen, not track execution. Execution state lives in a separate procedure-run card.

Don't modify a procedure card while a run is active. The engine reads the definition at run start. Changes during execution won't be picked up and may cause confusion.

Each entry in \`steps\` has optional phases: \`precheck\` (should this step run?), \`run\` (the main action), \`validate\` (did it work?). Each phase groups its actions by kind:

- \`shells:\` — a list of bash commands run in the box root. **The only kind that
  actually gates** a \`validate\` (with \`severity: abort\`).
- \`agents:\` — a list of \`{ prompt, model?, max-turns? }\` Claude Code invocations.
- \`instructions:\` — *intended* as model-judged pass/fail, but **not implemented
  yet** (logged, pass-by-default). Don't gate on it; put real checks in \`shells:\`.
- \`whys:\` — a list of explanations (for humans, fixing agents, and review models).

Use YAML block scalars (\`|\`) for multi-line shell scripts and agent prompts so indentation is preserved. \`precheck.pass-output: true\` passes precheck stdout into the run phase. \`validate.severity\` is warn/review/abort — but \`review\`'s auto-retry is **not implemented** (it downgrades to warn), so \`abort\` is the only severity that gates.

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
