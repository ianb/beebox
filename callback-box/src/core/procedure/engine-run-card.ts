/**
 * Run-card serialization and mutation — building the initial run card and
 * applying status/step updates as the procedure executes.
 *
 * Run cards are Phase-2 frontmatter (YAML, no body). The engine owns the
 * read-mutate-write cycle; strict Zod validation happens when the card is
 * loaded (cb validate / parseProcedureRun), so the mutators here work on a
 * plain mutable shape whose statuses are strings (matching StepUpdate).
 */

import * as fs from "node:fs/promises";
import { renderFrontmatterBlock, splitCardContent } from "../../cards/index.js";
import { parse as parseYaml } from "yaml";
import type { ParsedProcedure, StepUpdate } from "./engine-types.js";

/** Raised when a run card can't be read as YAML frontmatter. */
export class RunCardParseError extends Error {
  constructor(runCardPath: string) {
    super(`Run card is not valid frontmatter: ${runCardPath}`);
    this.name = "RunCardParseError";
  }
}

interface MutablePhasePrecheck {
  status: string;
  stdout?: string;
}
interface MutablePhaseRun {
  "session-id"?: string;
  stdout?: string;
  "git-ref"?: string;
}
interface MutablePhaseValidate {
  status: string;
  stdout?: string;
  review?: string;
}
interface MutableStep {
  id: string;
  status: string;
  "started-at"?: string;
  "completed-at"?: string;
  precheck?: MutablePhasePrecheck;
  run?: MutablePhaseRun;
  validate?: MutablePhaseValidate;
}
interface MutableRunCard {
  procedure: string;
  status: string;
  "started-at": string;
  "completed-at"?: string;
  directive?: string;
  expires?: string;
  steps: MutableStep[];
}

function serializeRunCard(card: MutableRunCard): string {
  return renderFrontmatterBlock(card);
}

async function readRunCard(runCardPath: string): Promise<MutableRunCard> {
  const content = await fs.readFile(runCardPath, "utf-8");
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) throw new RunCardParseError(runCardPath);
  let parsed: unknown;
  try {
    parsed = parseYaml(split.frontmatterText);
  } catch (_e) {
    throw new RunCardParseError(runCardPath);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RunCardParseError(runCardPath);
  }
  // Parse boundary: run cards are engine-written YAML, strict-validated on
  // load (cb validate / parseProcedureRun); the mutators trust the shape.
  return parsed as MutableRunCard;
}

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
 * Build the initial run card (all steps pending).
 */
export function buildInitialRunCard(params: BuildInitialRunCardParams): string {
  const { procedure, procedurePath, startedAt, directive } = params;
  const steps: MutableStep[] = procedure.steps.map((step) => ({
    id: step.id,
    status: "pending",
  }));
  const card: MutableRunCard = {
    procedure: procedurePath,
    status: "running",
    "started-at": startedAt,
    ...(directive !== undefined && directive !== "" ? { directive } : {}),
    steps,
  };
  return serializeRunCard(card);
}

/**
 * Parameters for updateRunCardStatus
 */
export interface UpdateRunCardStatusParams {
  runCardPath: string;
  status: string;
  completedAt?: string;
  /** Expiry stamp ("never" or ISO datetime) — see run-expiry.ts */
  expires?: string;
}

/**
 * Update the run card's overall status.
 */
export async function updateRunCardStatus(params: UpdateRunCardStatusParams): Promise<void> {
  const { runCardPath, status, completedAt, expires } = params;
  const card = await readRunCard(runCardPath);
  card.status = status;
  if (completedAt !== undefined) card["completed-at"] = completedAt;
  if (expires !== undefined) card.expires = expires;
  await fs.writeFile(runCardPath, serializeRunCard(card));
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
 * Build a step's execution record from an update. Timestamps persist from
 * the previous record; precheck/run/validate are replaced wholesale (the
 * final update carries the complete set).
 */
function applyStepUpdate(prev: MutableStep, update: StepUpdate): MutableStep {
  const step: MutableStep = { id: prev.id, status: update.status };
  const startedAt = update.startedAt ?? prev["started-at"];
  if (startedAt !== undefined) step["started-at"] = startedAt;
  const completedAt = update.completedAt ?? prev["completed-at"];
  if (completedAt !== undefined) step["completed-at"] = completedAt;

  if (update.precheck) {
    step.precheck = { status: update.precheck.status };
    if (update.precheck.stdout) step.precheck.stdout = update.precheck.stdout;
  }
  if (update.run) {
    const run: MutablePhaseRun = {};
    if (update.run.sessionId) run["session-id"] = update.run.sessionId;
    if (update.run.stdout) run.stdout = update.run.stdout;
    if (update.run.gitRef) run["git-ref"] = update.run.gitRef;
    step.run = run;
  }
  if (update.validate) {
    step.validate = { status: update.validate.status };
    if (update.validate.stdout) step.validate.stdout = update.validate.stdout;
    if (update.validate.review) step.validate.review = update.validate.review;
  }
  return step;
}

/**
 * Update a specific step in the run card.
 */
export async function updateStepInRunCard(params: UpdateStepInRunCardParams): Promise<void> {
  const { runCardPath, stepId, update } = params;
  const card = await readRunCard(runCardPath);
  const idx = card.steps.findIndex((s) => s.id === stepId);
  const prev = idx === -1 ? undefined : card.steps[idx];
  if (prev !== undefined) {
    card.steps[idx] = applyStepUpdate(prev, update);
  }
  await fs.writeFile(runCardPath, serializeRunCard(card));
}
