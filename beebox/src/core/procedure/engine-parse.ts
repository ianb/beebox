/**
 * Procedure definition parsing — turns a procedure card's YAML frontmatter
 * into the structured {@link ParsedProcedure} the engine executes.
 */

import * as fs from "node:fs/promises";
import {
  parseProcedureDefinition,
  type ProcedureStepDef,
} from "../../schemas/procedure.js";
import { validateRunExpiry } from "./run-expiry.js";
import type { ParsedPhase, ParsedStep, ParsedProcedure } from "./engine-types.js";

/** Raised when a procedure card can't be parsed as a valid definition. */
class ProcedureParseError extends Error {
  constructor(cardPath: string) {
    super(`Invalid procedure definition: ${cardPath}`);
    this.name = "ProcedureParseError";
  }
}

/**
 * Parse a procedure definition card into a structured object.
 */
export async function loadProcedureDefinition(
  cardPath: string
): Promise<ParsedProcedure> {
  const content = await fs.readFile(cardPath, "utf-8");
  const def = parseProcedureDefinition(content);
  if (def === null) throw new ProcedureParseError(cardPath);

  const result: ParsedProcedure = {
    name: def.name,
    description: def.description ?? "",
    steps: def.steps.map(toParsedStep),
  };
  if (def["run-expiry"] !== undefined) {
    validateRunExpiry("run-expiry", def["run-expiry"]);
    result.runExpiry = def["run-expiry"];
  }
  if (def["failed-run-expiry"] !== undefined) {
    validateRunExpiry("failed-run-expiry", def["failed-run-expiry"]);
    result.failedRunExpiry = def["failed-run-expiry"];
  }
  return result;
}

type PhaseFields = NonNullable<ProcedureStepDef["run"]>;

function toPhase(phase: PhaseFields): ParsedPhase {
  return {
    shells: phase.shells ?? [],
    agents: (phase.agents ?? []).map((a) => {
      const agent: ParsedPhase["agents"][number] = { prompt: a.prompt };
      if (a.model !== undefined) agent.model = a.model;
      if (a["max-turns"] !== undefined) agent.maxTurns = a["max-turns"];
      return agent;
    }),
    instructions: phase.instructions ?? [],
    whys: phase.whys ?? [],
  };
}

function toParsedStep(step: ProcedureStepDef): ParsedStep {
  const result: ParsedStep = { id: step.id, description: step.description ?? "" };
  if (step.precheck !== undefined) {
    result.precheck = {
      ...toPhase(step.precheck),
      passOutput: step.precheck["pass-output"] === true,
    };
  }
  if (step.run !== undefined) {
    result.run = toPhase(step.run);
  }
  if (step.validate !== undefined) {
    result.validate = {
      phase: toPhase(step.validate),
      severity: step.validate.severity ?? "warn",
      ...(step.validate.model !== undefined && { model: step.validate.model }),
    };
  }
  return result;
}
