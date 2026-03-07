/**
 * Batch job processing — groups non-chat jobs into a single agent session.
 *
 * This is the original reactor processing mode: all pending jobs are
 * described in one prompt, and the agent processes them sequentially,
 * calling `cb finish` after each. Efficient for small, independent jobs.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { schemas } from "../../schemas/registry.js";
import { ensureAgentCommitted, captureBaseline } from "../agent.js";
import { buildReactorSystemPrompt, buildReactorUserPrompt } from "./prompts.js";
import type { ProcessJobsOptions, JobWithContent } from "./types.js";

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
 */
export async function buildJobDescription(job: JobWithContent, boxRoot: string): Promise<string> {
  const priorityLabel = job.card.priority === "low" ? " *(low priority)*" : "";
  let desc = `### ${job.relPath}${priorityLabel}\n\`\`\`xml\n${job.content.trim()}\n\`\`\``;

  const refs = extractRefs(job.content);
  for (const ref of refs) {
    const refPath = path.join(boxRoot, ref);
    try {
      const refContent = await fs.readFile(refPath, "utf-8");
      desc += `\n\n#### ${ref}\n\`\`\`xml\n${refContent.trim()}\n\`\`\``;
    } catch {
      // Referenced file doesn't exist — agent will discover this
    }
  }

  const rootTag = extractRootTag(job.content);
  if (rootTag) {
    const instructions = getSchemaInstructions(rootTag);
    if (instructions) {
      desc += `\n\n#### Instructions for ${rootTag}\n${instructions}`;
    }
  }

  return desc;
}

/**
 * Extract ref="..." attributes from elements like <thread ref="..."> and <item ref="...">.
 */
function extractRefs(xmlContent: string): string[] {
  const refs: string[] = [];
  const pattern = /<(?:thread|item)\s[^>]*ref="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(xmlContent)) !== null) {
    refs.push(match[1]!);
  }
  return refs;
}

/**
 * Extract the root element tag name from XML content (e.g. "chat-job" from "<chat-job ...>").
 */
function extractRootTag(xmlContent: string): string | null {
  const match = xmlContent.match(/<([a-z][\w-]*)/);
  return match ? match[1]! : null;
}

/**
 * Look up schema instructions for a given root tag name.
 */
function getSchemaInstructions(tagName: string): string | null {
  const schema = schemas.find((s) => s.tagName === tagName);
  return schema?.instructions ?? null;
}
