/**
 * Batch job processing — groups non-chat jobs into a single agent session.
 *
 * This is the original reactor processing mode: all pending jobs are
 * described in one prompt, and the agent processes them sequentially,
 * calling `cb finish` after each. Efficient for small, independent jobs.
 */

import {
  resolveBoxRelativeRef,
  readContainedFile,
  RefEscapesBoxError,
} from "../../lib/box-containment.js";
import { fenceForPrompt } from "../../lib/prompt-fence.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { parseCardText, CardIOError } from "../card-io.js";
import { collectInlineRefs } from "../../cards/index.js";
import { ensureAgentCommitted, captureBaseline } from "../agent/index.js";
import { buildReactorSystemPrompt, buildReactorUserPrompt } from "./prompts.js";
import type { ProcessJobsOptions, JobWithContent } from "./types.js";
import { errnoCode } from "../../lib/error-guards.js";

/**
 * Process agent jobs in a single batched agent session.
 */
export async function processBatchJobs(opts: ProcessJobsOptions): Promise<boolean> {
  const { jobs, boxRoot, typeFilter, dryRun, onLog } = opts;
  const jobPaths = jobs.map((j) => j.relPath);
  const jobDescriptions: string[] = [];

  for (const job of jobs) {
    if (job.content) {
      jobDescriptions.push(await buildJobDescription(job, boxRoot));
    } else {
      const priorityLabel = job.card.priority === "low" ? " *(low priority)*" : "";
      jobDescriptions.push(`### ${job.relPath}${priorityLabel}\n(could not read)`);
    }
  }

  const systemPrompt = buildReactorSystemPrompt(boxRoot);
  const userPrompt = buildReactorUserPrompt(jobPaths, jobDescriptions);

  if (dryRun) {
    onLog?.("\n[DRY RUN] Would run agent with prompt:\n");
    onLog?.(userPrompt + "\n");
    return true;
  }

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
  });

  await ensureAgentCommitted({
    boxRoot,
    agent,
    baseline,
    fallbackMessage: "Reactor: agent work (fallback commit)",
    fallbackTrailers: { Phase: "reactor" },
    ...(onLog ? { onOutput: onLog } : {}),
  });

  return agentResult.success;
}

/**
 * Build a formatted job description with inlined refs and schema instructions.
 *
 * The job card is a YAML-frontmatter card: we parse it with the real card
 * loader, inline every inline-safe `{ref}` its frontmatter carries (intake
 * `items:`, chat `thread:`, question-followup `question-ref:`, …), and inject
 * the job type's schema instructions. "Inline-safe" is the schema's call:
 * `collectInlineRefs` skips `opaqueContentRef()` fields (raw external content
 * like an email body), so only `cardRef()`/un-migrated refs are read in. A job
 * we can't parse as a card (legacy XML, a hand-edited or untyped job) is
 * surfaced visibly with its raw content rather than crashing the whole batch.
 *
 * All embedded content — the job body, each inlined ref, the raw-content
 * fallback — goes through `fenceForPrompt` so a backtick run inside it can't
 * close the fence and masquerade as prompt structure.
 */
export async function buildJobDescription(job: JobWithContent, boxRoot: string): Promise<string> {
  const priorityLabel = job.card.priority === "low" ? " *(low priority)*" : "";
  const header = `### ${job.relPath}${priorityLabel}`;

  let parsed;
  try {
    const schemas = await createCardSchemaMap(boxRoot);
    parsed = parseCardText(job.content, { source: job.relPath, schemas });
  } catch (e) {
    if (e instanceof CardIOError) {
      // Not a recognized frontmatter card. Show the raw content so the agent
      // can still act, flagged so the failure isn't silent.
      return `${header}\n_⚠️ Could not parse this job as a card (${e.detail}); showing raw content._\n${fenceForPrompt(job.content.trim())}`;
    }
    throw e;
  }

  let desc = `${header}\n${fenceForPrompt(job.content.trim())}`;

  for (const ref of collectInlineRefs(parsed.schema.frontmatterSchema, parsed.fields)) {
    const contained = resolveBoxRelativeRef(boxRoot, ref);
    if (contained === null) {
      // An escaping ref inlined here would be an arbitrary local-file read into
      // the agent's prompt. Treat it as broken (omit), but never silently.
      console.warn(`buildJobDescription: ref "${ref}" in ${job.relPath} escapes the box; omitting`);
      continue;
    }
    try {
      const refContent = await readContainedFile(boxRoot, contained);
      desc += `\n\n#### ${ref}\n${fenceForPrompt(refContent.trim())}`;
    } catch (e) {
      if (e instanceof RefEscapesBoxError) {
        console.warn(`buildJobDescription: ref "${ref}" in ${job.relPath} resolves outside the box via symlink; omitting`);
      } else if (errnoCode(e) !== "ENOENT") {
        // Referenced file doesn't exist — omit it; the agent will discover this.
        console.debug(`Could not inline ref ${ref}:`, e);
      }
    }
  }

  const { instructions, type } = parsed.schema;
  if (instructions) {
    desc += `\n\n#### Instructions for ${type}\n${instructions}`;
  }

  return desc;
}
