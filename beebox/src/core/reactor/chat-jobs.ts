/**
 * Chat job processing — one agent call per thread with session reuse.
 *
 * Chat jobs differ from batch jobs in that each job gets its own agent
 * invocation, and sessions persist across reactor cycles. This enables
 * conversational context: the agent "remembers" prior messages in the
 * same thread via Claude Code's session resume feature.
 *
 * Sessions are keyed by thread ref (or job path as fallback) and stored
 * in `.beebox/chat-sessions.json`. Failed sessions are reset so
 * the next message starts fresh.
 */

import { ensureAgentCommitted, captureBaseline } from "../agent/index.js";
import {
  loadChatSessions,
  saveChatSessions,
  getOrCreateSession,
  markSessionUsed,
  resetSession,
} from "../chat/reactor-sessions.js";
import { buildReactorSystemPrompt } from "./prompts.js";
import { computeTodoAmbientLine } from "../todo/ambient-summary.js";
import { buildJobDescription } from "./batch-jobs.js";
import { readCardFrontmatter, isRecord } from "../card-io.js";
import { fmt } from "../../lib/format.js";
import { loadEffectiveBoxModel } from "../model-policy.js";
import type { ProcessJobsOptions } from "./types.js";

/**
 * Process chat jobs individually, one agent call per thread,
 * reusing Claude Code sessions across reactor invocations.
 */
export async function processChatJobs(opts: ProcessJobsOptions): Promise<boolean> {
  const { jobs, boxRoot, dryRun, onLog } = opts;
  const sessions = await loadChatSessions(boxRoot);
  // One resolution for the whole cycle, so every thread in it runs the same
  // model even if the box default changes partway (model-engine-policy).
  const boxModel = await loadEffectiveBoxModel(boxRoot);
  if (boxModel !== null) onLog?.(fmt.dim(`  Model: ${boxModel}\n`));
  let allSuccess = true;

  for (const job of jobs) {
    const threadRef = extractThreadRef(job.content);
    const sessionKey = threadRef ?? job.relPath; // fall back to job path if no thread ref

    if (threadRef) {
      onLog?.(fmt.dim(`  Thread: ${threadRef}\n`));
    }

    const { sessionId, resume } = getOrCreateSession(sessions, sessionKey);
    onLog?.(fmt.dim(`  Session: ${sessionId.slice(0, 8)}... (${resume ? "resume" : "new"})\n`));

    const desc = await buildJobDescription(job, boxRoot);
    const ambientLine = await computeTodoAmbientLine(boxRoot);
    const ambientBlock = ambientLine !== null ? `${ambientLine}\n\n` : "";
    const userPrompt = `${ambientBlock}Please process this job:\n\n${desc}\n\nProcess it according to the instructions, then call \`bbx finish\` when done.`;

    if (dryRun) {
      onLog?.("\n[DRY RUN] Would run agent with prompt:\n");
      onLog?.(userPrompt + "\n");
      continue;
    }

    const systemPrompt = buildReactorSystemPrompt(boxRoot);
    const agent = opts.createAgent({
      name: "reactor-chat",
      sessionId,
      resume,
      ...(onLog && { onOutput: onLog }),
    });

    onLog?.("\n");
    const baseline = await captureBaseline(boxRoot);
    const agentResult = await agent.invoke({
      boxRoot,
      systemPrompt,
      prompt: userPrompt,
      maxTurns: 10,
      ...(boxModel !== null && { model: boxModel }),
    });

    await ensureAgentCommitted({
      boxRoot,
      agent,
      baseline,
      fallbackMessage: "Reactor: chat agent work (fallback commit)",
      fallbackTrailers: { Phase: "reactor" },
      ...(onLog ? { onOutput: onLog } : {}),
    });

    if (agentResult.success) {
      markSessionUsed(sessions, sessionKey);
    } else {
      // Failed — reset so next message starts fresh
      resetSession(sessions, sessionKey);
      allSuccess = false;
      if (agentResult.unavailability !== undefined) {
        // Deferred-recoverable (engine quota exhausted): every remaining
        // thread would fail identically — leave them for a later cycle.
        onLog?.(fmt.warn("Engine unavailable — leaving remaining chat jobs for a later cycle.\n"));
        break;
      }
    }
  }

  await saveChatSessions(boxRoot, sessions);
  return allSuccess;
}

/**
 * Extract the thread ref from a chat job card's frontmatter (`thread: {ref}`).
 * Returns null for a job with no parseable thread ref — the caller falls back
 * to the job path as the session key.
 */
function extractThreadRef(content: string): string | null {
  const thread = readCardFrontmatter(content)?.["thread"];
  if (isRecord(thread) && typeof thread["ref"] === "string") return thread["ref"];
  return null;
}
