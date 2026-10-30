/**
 * Batch job processing — groups jobs into a single agent session.
 *
 * The reactor's processing mode: the jobs are described in one prompt, and
 * the agent processes them sequentially, calling `bbx finish` after each.
 *
 * The prompt is bounded. A job pastes its refs in up to
 * `JOB_INLINE_BUDGET_BYTES` and lists the rest by path; the assembled prompt
 * stays within `BATCH_PROMPT_BUDGET_BYTES`, so later jobs that do not fit wait
 * for the next cycle (`selectBatch`). A 300-item intake job once made a 3 MB
 * prompt that the model refused (docs/implemented-plans/bounded-reactor-batches.md).
 */

import {
  resolveBoxRelativeRef,
  readContainedFile,
  RefEscapesBoxError,
} from "../../../lib/box-containment.js";
import { fenceForPrompt } from "../../../lib/prompt-fence.js";
import { createCardSchemaMap } from "../../../schemas.js";
import { parseCardText, CardIOError } from "../../card-io.js";
import { collectInlineRefs } from "../../../exports/cards.js";
import { ensureAgentCommitted, captureBaseline } from "../../agent/invoke/core.js";
import { buildReactorSystemPrompt, buildReactorUserPrompt } from "../prompts.js";
import { computeTodoAmbientLine } from "../../todo/ambient-summary.js";
import type { ProcessJobsOptions, JobWithContent } from "../types.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { loadEffectiveBoxModel } from "../../model-policy.js";
import { isIntakeJob } from "../../../job-cards/intake-utils.js";

/** A hard limit on the UTF-8 bytes of the assembled batch prompt (about 40,000 to 55,000 tokens). */
export const BATCH_PROMPT_BUDGET_BYTES = 160 * 1024;

/** The most bytes of pasted ref content one job description carries; the rest are listed by path. */
export const JOB_INLINE_BUDGET_BYTES = 40 * 1024;

/** The heading over the refs a description lists instead of pasting. */
export const NOT_PASTED_HEADING = "#### Not pasted in (open these with your tools)";

/** The assembled prompt was over the budget anyway: one job type's instructions alone exceed it. */
export class BatchPromptTooLargeError extends Error {
  constructor({ bytes, budget }: { bytes: number; budget: number }) {
    super(`The reactor batch prompt is ${String(bytes)} bytes, over its ${String(budget)}-byte budget; no agent session was started.`);
    this.name = "BatchPromptTooLargeError";
  }
}

const byteLength = (text: string): number => Buffer.byteLength(text, "utf8");

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${String(bytes)} B` : `${String(Math.round(bytes / 1024))} KB`;
}

/** A job's description in each form selection may send, smallest last. */
export interface JobForms {
  relPath: string;
  /** Refs pasted up to the per-job budget, the rest listed. */
  full: string;
  /** Every ref listed by path. */
  listed: string;
  /** The card itself named by path with an instruction to open it. */
  byPath: string;
}

/** What one cycle sends, and what waits. */
export interface BatchSelection {
  selected: { relPath: string; description: string }[];
  deferred: string[];
}

/**
 * Choose the jobs one batch prompt carries, in the order given (normal before
 * low, oldest first). `assemble` builds the prompt from chosen descriptions, so
 * each choice is measured on the prompt it would produce, framing and
 * separators included. The first job is always selected: in full if that
 * fits, else with every ref listed, else given by path. Each later job is
 * selected only if its full description fits (first fit); the rest wait.
 * A batch carries at most one intake job: the budget counts bytes, but a
 * session runs out of turns first, and six 25-item scan jobs that fit the
 * bytes left one session filing none of them.
 */
export function selectBatch(
  jobs: JobForms[],
  opts: { assemble: (selected: BatchSelection["selected"]) => string; budget: number },
): BatchSelection {
  const { assemble, budget } = opts;
  const selected: BatchSelection["selected"] = [];
  const deferred: string[] = [];
  const fits = (candidate: { relPath: string; description: string }): boolean =>
    byteLength(assemble([...selected, candidate])) <= budget;
  let intakeSelected = false;
  for (const [i, job] of jobs.entries()) {
    const intake = isIntakeJob(job.relPath);
    if (i === 0) {
      const form = [job.full, job.listed].find((description) => fits({ relPath: job.relPath, description })) ?? job.byPath;
      selected.push({ relPath: job.relPath, description: form });
      intakeSelected = intake;
    } else if (intake && intakeSelected) {
      deferred.push(job.relPath);
    } else if (fits({ relPath: job.relPath, description: job.full })) {
      intakeSelected ||= intake;
      selected.push({ relPath: job.relPath, description: job.full });
    } else {
      deferred.push(job.relPath);
    }
  }
  return { selected, deferred };
}

/** What a batch did: whether its session succeeded, and which jobs it was sent. */
export interface BatchOutcome {
  success: boolean;
  selected: string[];
}

/**
 * Process agent jobs in a single batched agent session: those that fit the
 * prompt budget (`selectBatch`); the rest stay pending for a later cycle.
 */
export async function processBatchJobs(opts: ProcessJobsOptions): Promise<BatchOutcome> {
  const { jobs, boxRoot, typeFilter, dryRun, onLog } = opts;
  const forms: JobForms[] = [];
  for (const job of jobs) forms.push(await describeJob(job, boxRoot));

  const systemPrompt = buildReactorSystemPrompt();
  const ambientLine = await computeTodoAmbientLine(boxRoot);
  const assemble = (selected: BatchSelection["selected"]): string =>
    buildReactorUserPrompt(selected.map((s) => s.relPath), { jobDescriptions: selected.map((s) => s.description), ambientLine });
  const budget = opts.promptBudget ?? BATCH_PROMPT_BUDGET_BYTES;
  const { selected, deferred } = selectBatch(forms, { assemble, budget });
  for (const relPath of deferred) onLog?.(`  deferred to a later cycle: ${relPath}\n`);
  const userPrompt = assemble(selected);
  const promptBytes = byteLength(userPrompt);
  // Selection measured each choice, so only a first job whose by-path form is
  // over the budget (its type's instructions alone) can land here.
  if (promptBytes > budget) throw new BatchPromptTooLargeError({ bytes: promptBytes, budget });
  const selectedPaths = selected.map((s) => s.relPath);

  if (dryRun) {
    onLog?.(`\n[DRY RUN] Would send ${String(selected.length)} job(s), ${formatSize(promptBytes)} prompt; ${String(deferred.length)} deferred.\n`);
    onLog?.("[DRY RUN] Would run agent with prompt:\n");
    onLog?.(userPrompt + "\n");
    return { success: true, selected: selectedPaths };
  }
  // Resolved once for the whole run: a pin that lands mid-run does not switch
  // the model out from under the agent (docs/implemented-plans/model-engine-policy.md).
  const boxModel = await loadEffectiveBoxModel(boxRoot);
  if (boxModel !== null) onLog?.(`  Model: ${boxModel}\n`);

  onLog?.("\n");
  const maxTurns = typeFilter ? 10 : 30;
  const agent = opts.createAgent({
    name: "reactor-batch",
    ...(onLog && { onOutput: onLog }),
  });

  const baseline = await captureBaseline(boxRoot);
  const agentResult = await agent.invoke({
    boxRoot,
    systemPrompt,
    prompt: userPrompt,
    maxTurns,
    maxBudgetUsd: 10,
    ...(boxModel !== null && { model: boxModel }),
  });

  await ensureAgentCommitted({
    boxRoot,
    agent,
    baseline,
    fallbackMessage: "Reactor: agent work (fallback commit)",
    fallbackTrailers: { Phase: "reactor" },
    ...(onLog ? { onOutput: onLog } : {}),
  });

  return { success: agentResult.success, selected: selectedPaths };
}

/** A ref's content as read for pasting, or null when it is omitted (logged). */
async function readRef(boxRoot: string, opts: { ref: string; relPath: string }): Promise<string | null> {
  const { ref, relPath } = opts;
  const contained = resolveBoxRelativeRef(boxRoot, ref);
  if (contained === null) {
    // An escaping ref inlined here would be an arbitrary local-file read into
    // the agent's prompt. Treat it as broken (omit), but never silently.
    console.warn(`describeJob: ref "${ref}" in ${relPath} escapes the box; omitting`);
    return null;
  }
  try {
    return await readContainedFile(boxRoot, contained);
  } catch (e) {
    if (e instanceof RefEscapesBoxError) {
      console.warn(`describeJob: ref "${ref}" in ${relPath} resolves outside the box via symlink; omitting`);
    } else if (errnoCode(e) !== "ENOENT") {
      // Referenced file doesn't exist — omit it; the agent will discover this.
      console.debug(`Could not inline ref ${ref}:`, e);
    }
    return null;
  }
}

function listedSection(refs: { ref: string; bytes: number }[]): string {
  if (refs.length === 0) return "";
  return `\n\n${NOT_PASTED_HEADING}\n${refs.map(({ ref, bytes }) => `- ${ref} (${formatSize(bytes)})`).join("\n")}`;
}

/**
 * Every form of a job's description selection may send.
 *
 * The job card is a YAML-frontmatter card: we parse it with the real card
 * loader, take every inline-safe `{ref}` its frontmatter carries (intake
 * `items:`, chat `thread:`, question-followup `question-ref:`, …), and add the
 * job type's schema instructions. "Inline-safe" is the schema's call:
 * `collectInlineRefs` skips `opaqueContentRef()` fields (raw external content
 * like an email body), so only `cardRef()`/un-migrated refs are read in. A job
 * we can't parse as a card (legacy XML, a hand-edited or untyped job) is
 * surfaced visibly with its raw content rather than crashing the whole batch.
 *
 * Refs are pasted in order while their total stays within the per-job budget;
 * the ref that would cross it and every ref after it are listed under
 * {@link NOT_PASTED_HEADING}. All embedded content goes through
 * `fenceForPrompt` so a backtick run inside it can't close the fence and
 * masquerade as prompt structure.
 */
export async function describeJob(job: JobWithContent, boxRoot: string): Promise<JobForms> {
  const priorityLabel = job.card.priority === "low" ? " *(low priority)*" : "";
  const header = `### ${job.relPath}${priorityLabel}`;
  const tooLarge = `This job's card is too large to paste (${formatSize(byteLength(job.content))}). Open it before you start: ${job.relPath}`;
  if (!job.content) {
    const unreadable = `${header}\n(could not read)`;
    return { relPath: job.relPath, full: unreadable, listed: unreadable, byPath: unreadable };
  }

  let parsed;
  try {
    const schemas = await createCardSchemaMap(boxRoot);
    parsed = parseCardText(job.content, { source: job.relPath, schemas });
  } catch (e) {
    if (e instanceof CardIOError) {
      // Not a recognized frontmatter card. Show the raw content so the agent
      // can still act, flagged so the failure isn't silent.
      const raw = `${header}\n_⚠️ Could not parse this job as a card (${e.detail}); showing raw content._\n${fenceForPrompt(job.content.trim())}`;
      return { relPath: job.relPath, full: raw, listed: raw, byPath: `${header}\n${tooLarge}` };
    }
    throw e;
  }

  const card = `${header}\n${fenceForPrompt(job.content.trim())}`;
  const refs: { ref: string; content: string }[] = [];
  for (const ref of collectInlineRefs(parsed.schema.frontmatterSchema, parsed.fields)) {
    const content = await readRef(boxRoot, { ref, relPath: job.relPath });
    if (content !== null) refs.push({ ref, content });
  }
  let pasted = "";
  let crossed = refs.length;
  for (const [i, { ref, content }] of refs.entries()) {
    const section = `\n\n#### ${ref}\n${fenceForPrompt(content.trim())}`;
    if (byteLength(pasted + section) > JOB_INLINE_BUDGET_BYTES) {
      crossed = i;
      break;
    }
    pasted += section;
  }
  const sized = refs.map(({ ref, content }) => ({ ref, bytes: byteLength(content) }));
  const { instructions, type } = parsed.schema;
  const instructionBlock = instructions ? `\n\n#### Instructions for ${type}\n${instructions}` : "";
  return {
    relPath: job.relPath,
    full: `${card}${pasted}${listedSection(sized.slice(crossed))}${instructionBlock}`,
    listed: `${card}${listedSection(sized)}${instructionBlock}`,
    byPath: `${header}\n${tooLarge}${instructionBlock}`,
  };
}
