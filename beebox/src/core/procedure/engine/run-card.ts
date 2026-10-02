/**
 * Run-card serialization and mutation — building the initial run card and
 * applying outcome/step updates as the procedure executes.
 *
 * Run cards are Phase-2 frontmatter (YAML, no body). The engine owns the
 * read-mutate-write cycle; strict Zod validation happens when the card is
 * loaded (bbx validate / parseProcedureRun), so the mutators here work on a
 * plain mutable shape whose statuses are strings (matching StepUpdate).
 */

import * as fs from "node:fs/promises";
import { renderFrontmatterBlock, splitCardContent } from "../../../exports/cards.js";
import { parse as parseYaml } from "yaml";
import { invariant } from "../../../shared/invariant.js";
import {
  canReopenRun,
  isRunOutcome,
  type ParsedProcedure,
  type StepUpdate,
  type RunOutcome,
} from "../engine-types.js";
import type { InconclusiveReason } from "../../../shared/inconclusive.js";

/** Raised when a run card can't be read as YAML frontmatter. */
class RunCardParseError extends Error {
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
  error?: string;
  "git-ref"?: string;
}
interface MutablePhaseValidate {
  status: string;
  stdout?: string;
  review?: string;
  error?: string;
  /** Why an `inconclusive` check reached no verdict (tag, not prose). */
  reason?: InconclusiveReason;
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
  outcome?: string;
  "started-at": string;
  "completed-at"?: string;
  directive?: string;
  expires?: string;
  steps: MutableStep[];
}

function serializeRunCard(card: MutableRunCard): string {
  // `outcome` goes right after `procedure`, where a reader looks first, not
  // after the step list.
  const { procedure, outcome, ...rest } = card;
  return renderFrontmatterBlock({ procedure, ...(outcome !== undefined && { outcome }), ...rest });
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
  // load (bbx validate / parseProcedureRun) — duplicating that Zod validation
  // here just to satisfy these internal, engine-only mutators would be
  // disproportionate; they trust the shape they themselves wrote.
  // eslint-disable-next-line no-restricted-syntax -- parse boundary already strict-validated elsewhere (bbx validate/parseProcedureRun); re-validating here is disproportionate for an engine-internal mutator
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
 * Build the initial run card (all steps pending, no outcome yet).
 */
export function buildInitialRunCard(params: BuildInitialRunCardParams): string {
  const { procedure, procedurePath, startedAt, directive } = params;
  const steps: MutableStep[] = procedure.steps.map((step) => ({
    id: step.id,
    status: "pending",
  }));
  const card: MutableRunCard = {
    procedure: procedurePath,
    "started-at": startedAt,
    ...(directive !== undefined && directive !== "" ? { directive } : {}),
    steps,
  };
  return serializeRunCard(card);
}

/** The card's recorded outcome, which must be a known one when present. */
function recordedOutcome(card: MutableRunCard, runCardPath: string): RunOutcome | undefined {
  const { outcome } = card;
  if (outcome === undefined) return undefined;
  invariant(isRunOutcome(outcome), `Run card has unknown outcome "${outcome}": ${runCardPath}`);
  return outcome;
}

/**
 * Parameters for finishRunCard
 */
export interface FinishRunCardParams {
  runCardPath: string;
  outcome: RunOutcome;
  completedAt: string;
  /** Expiry stamp ("never" or ISO datetime) — see run-expiry.ts */
  expires: string;
}

/**
 * Record how the run finished. The run card is engine-written internal state,
 * not user input: a card that already has an outcome means a caller bug (a
 * finished run finished again without being re-opened), so fail loudly rather
 * than overwrite it.
 */
export async function finishRunCard(params: FinishRunCardParams): Promise<void> {
  const { runCardPath, outcome, completedAt, expires } = params;
  const card = await readRunCard(runCardPath);
  const prior = recordedOutcome(card, runCardPath);
  invariant(prior === undefined, `Run already finished (${String(prior)}), cannot record ${outcome}: ${runCardPath}`);
  card.outcome = outcome;
  card["completed-at"] = completedAt;
  card.expires = expires;
  await fs.writeFile(runCardPath, serializeRunCard(card));
}

/**
 * Re-open a run for resume: remove its outcome, if it has one that may be
 * re-opened (see `canReopenRun`). Rewrites the card either way, so its mtime
 * says the run is live again.
 */
export async function reopenRunCard(runCardPath: string): Promise<void> {
  const card = await readRunCard(runCardPath);
  const prior = recordedOutcome(card, runCardPath);
  invariant(canReopenRun(prior), `A ${String(prior)} run cannot be re-opened: ${runCardPath}`);
  delete card.outcome;
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
    if (update.run.error) run.error = update.run.error;
    if (update.run.gitRef) run["git-ref"] = update.run.gitRef;
    step.run = run;
  }
  if (update.validate) {
    step.validate = { status: update.validate.status };
    if (update.validate.stdout) step.validate.stdout = update.validate.stdout;
    if (update.validate.review) step.validate.review = update.validate.review;
    if (update.validate.error) step.validate.error = update.validate.error;
    if (update.validate.reason) step.validate.reason = update.validate.reason;
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
