/**
 * Run-card serialization and mutation — building the initial run card and
 * applying status/step updates as the procedure executes.
 */

import * as fs from "node:fs/promises";
import { createElement, serialize, parseCard, type ElementNode } from "cardworks";
import type { ParsedProcedure, StepUpdate } from "./engine-types.js";

/**
 * Parameters for buildInitialRunCard
 */
export interface BuildInitialRunCardParams {
  procedure: ParsedProcedure;
  procedurePath: string;
  startedAt: string;
  directive?: string;
}

/**
 * Build the initial run card XML.
 */
export function buildInitialRunCard(params: BuildInitialRunCardParams): string {
  const { procedure, procedurePath, startedAt, directive } = params;
  const stepElements = procedure.steps.map((step) =>
    createElement("step", {
      id: step.id,
      status: "pending",
    })
  );

  const root = createElement("procedure-run", {
    procedure: procedurePath,
    status: "running",
    "started-at": startedAt,
    ...(directive && { directive }),
    children: stepElements,
  });

  return serialize(root, { indent: "  " }) + "\n";
}

/**
 * Parameters for updateRunCardStatus
 */
export interface UpdateRunCardStatusParams {
  runCardPath: string;
  status: string;
  completedAt?: string;
}

/**
 * Update the run card's overall status.
 */
export async function updateRunCardStatus(params: UpdateRunCardStatusParams): Promise<void> {
  const { runCardPath, status, completedAt } = params;
  const content = await fs.readFile(runCardPath, "utf-8");
  const root = await parseCard(content, { source: runCardPath });

  root.attrs["status"] = status;
  if (completedAt) {
    root.attrs["completed-at"] = completedAt;
  }

  await fs.writeFile(runCardPath, serialize(root, { indent: "  " }) + "\n");
}

/**
 * Parameters for updateStepInRunCard
 */
export interface UpdateStepInRunCardParams {
  runCardPath: string;
  stepId: string;
  update: StepUpdate;
}

/**
 * Build the precheck/run/validate result child elements for a step update.
 */
function buildStepResultChildren(update: StepUpdate): ElementNode[] {
  const resultChildren: ElementNode[] = [];

  if (update.precheck) {
    const precheckChildren: ElementNode[] = [];
    if (update.precheck.stdout) {
      precheckChildren.push(
        createElement("stdout", { children: update.precheck.stdout })
      );
    }
    resultChildren.push(
      createElement("precheck", {
        status: update.precheck.status,
        children: precheckChildren,
      })
    );
  }

  if (update.run) {
    const runChildren: ElementNode[] = [];
    if (update.run.sessionId) {
      runChildren.push(
        createElement("session-id", { children: update.run.sessionId })
      );
    }
    if (update.run.stdout) {
      runChildren.push(
        createElement("stdout", { children: update.run.stdout })
      );
    }
    if (update.run.gitRef) {
      runChildren.push(
        createElement("git-ref", { children: update.run.gitRef })
      );
    }
    resultChildren.push(createElement("run", { children: runChildren }));
  }

  if (update.validate) {
    const validateChildren: ElementNode[] = [];
    if (update.validate.stdout) {
      validateChildren.push(
        createElement("stdout", { children: update.validate.stdout })
      );
    }
    if (update.validate.review) {
      validateChildren.push(
        createElement("review", { children: update.validate.review })
      );
    }
    resultChildren.push(
      createElement("validate", {
        status: update.validate.status,
        children: validateChildren,
      })
    );
  }

  return resultChildren;
}

/**
 * Update a specific step in the run card.
 */
export async function updateStepInRunCard(params: UpdateStepInRunCardParams): Promise<void> {
  const { runCardPath, stepId, update } = params;
  const content = await fs.readFile(runCardPath, "utf-8");
  const root = await parseCard(content, { source: runCardPath });

  for (const child of root.children as ElementNode[]) {
    if (child.tagName === "step" && child.attrs["id"] === stepId) {
      child.attrs["status"] = update.status;
      if (update.startedAt) {
        child.attrs["started-at"] = update.startedAt;
      }
      if (update.completedAt) {
        child.attrs["completed-at"] = update.completedAt;
      }

      child.children = buildStepResultChildren(update);
      break;
    }
  }

  await fs.writeFile(runCardPath, serialize(root, { indent: "  " }) + "\n");
}
