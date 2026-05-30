/**
 * Procedure definition parsing — turns a procedure card's XML into the
 * structured {@link ParsedProcedure} the engine executes.
 */

import * as fs from "node:fs/promises";
import { parseCard, type ElementNode } from "cardworks";
import { dedent } from "./dedent.js";
import type { ParsedPhase, ParsedStep, ParsedProcedure } from "./engine-types.js";

/**
 * Parse a procedure definition card into a structured object.
 */
export async function loadProcedureDefinition(
  cardPath: string
): Promise<ParsedProcedure> {
  const content = await fs.readFile(cardPath, "utf-8");
  const root = await parseCard(content, { source: cardPath });

  const name = root.attrs["name"] ?? "unknown";

  let description = "";
  const steps: ParsedStep[] = [];

  for (const child of root.children as ElementNode[]) {
    if (child.tagName === "description") {
      description = dedent(child.text ?? "");
    } else if (child.tagName === "step") {
      steps.push(parseStepDef(child));
    }
  }

  return { name, description, steps };
}

/**
 * Parse a step definition element.
 */
function parseStepDef(stepEl: ElementNode): ParsedStep {
  const id = stepEl.attrs["id"] ?? "unknown";
  let description = "";

  const result: ParsedStep = { id, description };

  for (const child of stepEl.children as ElementNode[]) {
    switch (child.tagName) {
      case "description":
        description = dedent(child.text ?? "");
        result.description = description;
        break;
      case "precheck":
        result.precheck = {
          ...parsePhaseDef(child),
          passOutput: child.attrs["pass-output"] === "true",
        };
        break;
      case "run":
        result.run = parsePhaseDef(child);
        break;
      case "validate":
        result.validate = {
          phase: parsePhaseDef(child),
          severity: child.attrs["severity"] ?? "warn",
        };
        break;
    }
  }

  return result;
}

/**
 * Parse a phase (precheck/run/validate) element into structured data.
 */
function parsePhaseDef(phaseEl: ElementNode): ParsedPhase {
  const shells: string[] = [];
  const agents: ParsedPhase["agents"] = [];
  const instructions: string[] = [];
  const whys: string[] = [];

  for (const child of phaseEl.children as ElementNode[]) {
    switch (child.tagName) {
      case "shell":
        shells.push(dedent(child.text ?? ""));
        break;
      case "agent": {
        const agentDef: ParsedPhase["agents"][number] = {
          prompt: dedent(child.text ?? ""),
        };
        if (child.attrs["model"]) {
          agentDef.model = child.attrs["model"];
        }
        if (child.attrs["max-turns"]) {
          agentDef.maxTurns = Number(child.attrs["max-turns"]);
        }
        agents.push(agentDef);
        break;
      }
      case "instruction":
        instructions.push(dedent(child.text ?? ""));
        break;
      case "why":
        whys.push(dedent(child.text ?? ""));
        break;
    }
  }

  return { shells, agents, instructions, whys };
}
