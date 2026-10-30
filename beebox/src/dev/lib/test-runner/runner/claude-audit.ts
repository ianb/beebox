/** Knowledge-audit behavior from a Claude Code session log and its sub-agent logs. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../../../../shared/error-guards.js";
import { MAX_SESSION_ENTRIES, parseSessionLog } from "../../../../cli/lib/session.js";
import { getSessionLogPath } from "../../../../core/chat/session/transcript-paths.js";
import { readTurnUsage, summarizeContextUsage } from "../../context-usage.js";
import { type BehaviorAccumulator, categorizeToolUse } from "./tool-use-behavior.js";
import { type ReplyBlock, visibleReplyText } from "./reply-text.js";
import type { AgentBehavior } from "./run-test.js";

export class KnowledgeAuditTranscriptError extends Error {
  constructor({ engine, sessionId, logPath }: { engine: "Claude" | "pi"; sessionId: string; logPath: string }, cause?: unknown) {
    super(`${engine} knowledge-audit transcript is missing for session ${sessionId}: ${logPath}. No audit checks were evaluated.`, { cause });
    this.name = "KnowledgeAuditTranscriptError";
  }
}

/**
 * Extract agent behavior from a session transcript.
 *
 * Also walks into sub-agent logs (sibling `<sessionId>/subagents/*.jsonl`
 * directory written by Claude Code when the main agent delegates via the
 * Agent tool). Sub-agent tool calls count as the main agent's behavior for
 * audit purposes — otherwise every delegated Read would be invisible.
 * Sub-agent response text is NOT merged into responseText; only the main
 * agent's text reply is evaluated. The agent may delete its own cwd (a
 * fixture directory); then `logDir` is used as given, so the caller passes the
 * path it resolved before the run.
 */
export async function extractBehavior(logDir: string, sessionId: string): Promise<AgentBehavior> {
  const physicalDir = await fs.realpath(logDir)
    .catch((error: unknown) => (errnoCode(error) === "ENOENT" ? logDir : Promise.reject(error)));
  const logPath = getSessionLogPath(physicalDir, sessionId);
  const { entries, total } = await parseSessionLog({
    logPath,
    slice: { mode: "page", offset: 0, limit: MAX_SESSION_ENTRIES },
  }).catch((error: unknown) => {
    if (errnoCode(error) === "ENOENT") throw new KnowledgeAuditTranscriptError({ engine: "Claude", sessionId, logPath }, error);
    throw error;
  });
  warnIfBehaviorReadTruncated({ logPath, entriesRead: entries.length, total });

  const acc: BehaviorAccumulator = { filesRead: [], searches: [], bashCommands: [], bashRawCommands: [] };
  const responseChunks: string[] = [];
  // Text blocks and progress updates in order; replyStart is where the blocks
  // after the last tool call start.
  const replyBlocks: ReplyBlock[] = [];
  let replyStart = 0;

  for (const entry of entries) {
    if (entry.type === "assistant") {
      for (const block of entry.content) {
        if (block.type === "text" && block.text) {
          responseChunks.push(block.text);
          replyBlocks.push({ text: block.text, update: false });
        }
        if (block.type === "thinking" && block.progressUpdate === true && block.text?.trim()) {
          replyBlocks.push({ text: block.text, update: true });
        }
        if (block.type === "tool_use") {
          categorizeToolUse(block, acc);
          replyStart = replyBlocks.length;
        }
      }
    }
  }

  // Merge tool uses from any sub-agent logs into the accumulator.
  const subagentDir = path.join(path.dirname(logPath), sessionId, "subagents");
  try {
    const subagentFiles = await fs.readdir(subagentDir);
    for (const file of subagentFiles) {
      if (!file.endsWith(".jsonl")) continue;
      const subagentLog = path.join(subagentDir, file);
      const { entries: subEntries, total: subTotal } = await parseSessionLog({
        logPath: subagentLog,
        slice: { mode: "page", offset: 0, limit: MAX_SESSION_ENTRIES },
      });
      warnIfBehaviorReadTruncated({ logPath: subagentLog, entriesRead: subEntries.length, total: subTotal });
      for (const entry of subEntries) {
        if (entry.type === "assistant") {
          for (const block of entry.content) {
            if (block.type === "tool_use") {
              categorizeToolUse(block, acc);
            }
          }
        }
      }
    }
  } catch (e) {
    // Sub-agent dir may not exist if the agent never delegated — that's fine.
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`[test-runner] Failed to read subagent logs at ${subagentDir}:`, e);
    }
  }

  const responseText = responseChunks.join("\n").trim();
  const replyText = visibleReplyText(replyBlocks, replyStart);

  // Context-size accounting reads the same main session log (not subagent
  // logs — those are separate contexts; baseline/peak is about what the box
  // agent itself carries every turn).
  const context = summarizeContextUsage(await readTurnUsage(logPath));

  return {
    ...acc,
    responseText,
    replyText,
    responseLength: responseText.split(/\s+/).length,
    context,
  };
}

function warnIfBehaviorReadTruncated(args: {
  logPath: string; entriesRead: number; total: number;
}): void {
  const { logPath, entriesRead, total } = args;
  if (entriesRead >= total) return;
  console.warn(
    `[test-runner] Behavior extraction from ${logPath} has ${String(total)} entries; using the first ${String(entriesRead)}.`,
  );
}
