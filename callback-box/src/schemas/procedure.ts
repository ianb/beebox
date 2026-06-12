/**
 * Procedure definition card schema.
 *
 * Defines the structure of procedure definition cards in config/procedures/.
 * A procedure is a sequence of steps, each with optional precheck, run, and validate phases.
 */

import { element } from "cardworks";
import { z } from "zod";

/**
 * Shell command element — executed via bash in the box root.
 */
export const ProcedureShell = element("shell", {
  text: z.string(),
});

/**
 * Instruction element — natural language for model evaluation.
 */
export const ProcedureInstruction = element("instruction", {
  text: z.string(),
});

/**
 * Why element — explanation of purpose for humans, fixing agents, and review models.
 */
export const ProcedureWhy = element("why", {
  text: z.string(),
});

/**
 * Agent element — invokes Claude Code with inline prompt.
 */
export const ProcedureAgent = element("agent", {
  attrs: {
    model: z.enum(["haiku", "sonnet", "opus"]).optional(),
    "max-turns": z.coerce.number().optional(),
  },
  text: z.string(),
});

/**
 * Children shared by all three phase containers (precheck, run, validate).
 */
const PhaseChildren = z.array(
  z.union([ProcedureShell, ProcedureAgent, ProcedureInstruction, ProcedureWhy])
);

/**
 * Precheck phase — runs before the main action to determine if the step should proceed.
 */
export const ProcedurePrecheck = element("precheck", {
  children: PhaseChildren,
});

/**
 * Run phase — the main action of a step.
 */
export const ProcedureRun = element("run", {
  children: PhaseChildren,
});

/**
 * Validate phase — runs after the main action to check results.
 */
export const ProcedureValidate = element("validate", {
  attrs: {
    severity: z.enum(["warn", "review", "abort"]).default("warn"),
  },
  children: PhaseChildren,
});

/**
 * Description element.
 */
export const ProcedureDescription = element("description", {
  text: z.string(),
});

/**
 * Step element — a single step in the procedure.
 */
export const ProcedureStep = element("step", {
  attrs: {
    id: z.string(),
  },
  children: z.array(
    z.union([ProcedureDescription, ProcedurePrecheck, ProcedureRun, ProcedureValidate])
  ),
});

/**
 * Procedure definition schema — the root element.
 */
/**
 * Run-expiry attribute value: a duration like "30d"/"12w", or "never".
 */
const RunExpiryValue = z.union([
  z.literal("never"),
  z.string().regex(/^\d+\.?\d*\s*[dhmsw]$/, 'duration like "30d", or "never"'),
]);

export const ProcedureSchema = element("procedure", {
  attrs: {
    name: z.string(),
    "run-expiry": RunExpiryValue.optional(),
    "failed-run-expiry": RunExpiryValue.optional(),
  },
  children: z.array(z.union([ProcedureDescription, ProcedureStep])),
  instructions: `# Handling Procedure Definitions

Procedure cards are declarative definitions — they describe WHAT should happen, not track execution. Execution state lives in a separate procedure-run card.

Don't modify a procedure card while a run is active. The engine reads the definition at run start. Changes during execution won't be picked up and may cause confusion.

Each <step> has optional phases: <precheck> (should this step run?), <run> (the main action), <validate> (did it work?). Each phase can contain <shell>, <agent>, or <instruction> elements.

<shell> runs bash commands in the box root. <agent> invokes Claude Code with the text as the prompt. <instruction> is evaluated by a model to produce a pass/fail judgment.

Optional \`run-expiry\` / \`failed-run-expiry\` attributes override how long this procedure's finished run dirs are kept before \`cb procedure gc\` deletes them (defaults: 30d completed, 90d failed). Value is a duration ("60d", "12w") or "never".`,
});

export type Procedure = z.infer<typeof ProcedureSchema>;
export type ProcedureStepDef = z.infer<typeof ProcedureStep>;
