/**
 * Workflow definition card schema.
 *
 * Defines the structure of workflow definition cards in config/workflows/.
 * A workflow is a sequence of steps, each with optional precheck, run, and validate phases.
 */

import { element } from "cardworks";
import { z } from "zod";

/**
 * Shell command element — executed via bash in the box root.
 */
export const WorkflowShell = element("shell", {
  text: z.string(),
});

/**
 * Instruction element — natural language for model evaluation.
 */
export const WorkflowInstruction = element("instruction", {
  text: z.string(),
});

/**
 * Why element — explanation of purpose for humans, fixing agents, and review models.
 */
export const WorkflowWhy = element("why", {
  text: z.string(),
});

/**
 * Agent element — invokes Claude Code with inline prompt.
 */
export const WorkflowAgent = element("agent", {
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
  z.union([WorkflowShell, WorkflowAgent, WorkflowInstruction, WorkflowWhy])
);

/**
 * Precheck phase — runs before the main action to determine if the step should proceed.
 */
export const WorkflowPrecheck = element("precheck", {
  children: PhaseChildren,
});

/**
 * Run phase — the main action of a step.
 */
export const WorkflowRun = element("run", {
  children: PhaseChildren,
});

/**
 * Validate phase — runs after the main action to check results.
 */
export const WorkflowValidate = element("validate", {
  attrs: {
    severity: z.enum(["warn", "review", "abort"]).default("warn"),
  },
  children: PhaseChildren,
});

/**
 * Description element.
 */
export const WorkflowDescription = element("description", {
  text: z.string(),
});

/**
 * Step element — a single step in the workflow.
 */
export const WorkflowStep = element("step", {
  attrs: {
    id: z.string(),
  },
  children: z.array(
    z.union([WorkflowDescription, WorkflowPrecheck, WorkflowRun, WorkflowValidate])
  ),
});

/**
 * Workflow definition schema — the root element.
 */
export const WorkflowSchema = element("workflow", {
  attrs: {
    name: z.string(),
  },
  children: z.array(z.union([WorkflowDescription, WorkflowStep])),
  instructions: `# Handling Workflow Definitions

Workflow cards are declarative definitions — they describe WHAT should happen, not track execution. Execution state lives in a separate workflow-run card.

Don't modify a workflow card while a run is active. The engine reads the definition at run start. Changes during execution won't be picked up and may cause confusion.

Each <step> has optional phases: <precheck> (should this step run?), <run> (the main action), <validate> (did it work?). Each phase can contain <shell>, <agent>, or <instruction> elements.

<shell> runs bash commands in the box root. <agent> invokes Claude Code with the text as the prompt. <instruction> is evaluated by a model to produce a pass/fail judgment.`,
});

export type Workflow = z.infer<typeof WorkflowSchema>;
export type WorkflowStepDef = z.infer<typeof WorkflowStep>;
