/**
 * Chat job processing — one agent call per thread with session reuse.
 *
 * Chat jobs differ from batch jobs in that each job gets its own agent
 * invocation, and sessions persist across reactor cycles. This enables
 * conversational context: the agent "remembers" prior messages in the
 * same thread via Claude Code's session resume feature.
 *
 * Sessions are keyed by thread ref (or job path as fallback) and stored
 * in `.callback-box/chat-sessions.json`. Failed sessions are reset so
 * the next message starts fresh.
 */

import { ensureAgentCommitted } from "../agent.js";
import {
  loadChatSessions,
  saveChatSessions,
  getOrCreateSession,
  markSessionUsed,
  resetSession,
} from "../chat-reactor-sessions.js";
import { buildReactorSystemPrompt } from "./prompts.js";
import { buildJobDescription } from "./batch-jobs.js";
import { fmt } from "../../cli/lib/format.js";
import type { ProcessJobsOptions } from "./types.js";

/**
 * Process chat jobs individually, one agent call per thread,
 * reusing Claude Code sessions across reactor invocations.
 */
export async function processChatJobs(opts: ProcessJobsOptions): Promise<boolean> {
  const { jobs, boxRoot, dryRun, onLog } = opts;
  const sessions = await loadChatSessions(boxRoot);
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
    const userPrompt = `Please process this job:\n\n${desc}\n\nProcess it according to the instructions, then call \`cb finish\` when done.`;

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
    const agentResult = await agent.invoke({
      boxRoot,
      systemPrompt,
      prompt: userPrompt,
      maxTurns: 10,
    });

    await ensureAgentCommitted({
      boxRoot,
      agent,
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
    }
  }

  await saveChatSessions(boxRoot, sessions);
  return allSuccess;
}

/**
 * Extract the thread ref from a job card's XML content.
 * Looks for <thread ref="..."> element.
 */
function extractThreadRef(xmlContent: string): string | null {
  const match = xmlContent.match(/<thread\s[^>]*ref="([^"]+)"/);
  return match ? match[1]! : null;
}
