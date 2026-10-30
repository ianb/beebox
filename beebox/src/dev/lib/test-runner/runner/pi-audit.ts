/**
 * Knowledge-audit behavior from a pi session file (JSONL version 3, read by
 * `piLines`). pi's tools are lowercase and take a `path`; they map onto the
 * audit vocabulary: `read` is a file read, `ls` a search, `bash` a command
 * (and a read or search when it runs one, as for Claude and Codex). An
 * instruction file a tool result delivered (`<nested-agents-md>`) counts as a
 * read at that result. `edit` and `write` are recorded only as the point of
 * the first edit, for `read_before_edit`. pi has no sub-agents. Each assistant
 * message's usage gives one turn's loaded context.
 */

import { z } from "zod";
import { deliveredGuidancePaths } from "../../../../core/agent/pi-run/session/core.js";
import { findPiSessionFile, piLines } from "../../../../core/chat/session/pi-transcript.js";
import { piSessionsDir } from "../../../../core/pi-sessions.js";
import { summarizeContextUsage, type TurnUsage } from "../../context-usage.js";
import { KnowledgeAuditTranscriptError } from "./claude-audit.js";
import { type ReplyBlock, visibleReplyText } from "./reply-text.js";
import { shellCommandConsultsFiles, shellCommandSearches } from "./shell-observation.js";
import type { BehaviorAccumulator } from "./tool-use-behavior.js";
import type { AgentBehavior } from "./run-test.js";

const blockSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("toolCall"), name: z.string(), arguments: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.string() }),
]);

const assistantRecordSchema = z.object({
  type: z.literal("message"),
  message: z.object({
    role: z.literal("assistant"),
    content: z.array(blockSchema),
    usage: z.object({ input: z.number(), cacheRead: z.number(), cacheWrite: z.number() }).optional(),
  }),
});

const toolResultRecordSchema = z.object({
  type: z.literal("message"),
  message: z.object({ role: z.literal("toolResult"), content: z.array(blockSchema) }),
});

const EDIT_TOOLS = new Set(["edit", "write"]);

/** Instruction files delivered in a tool result record, or none for any other record. */
function deliveredIn(record: Record<string, unknown>): string[] {
  const parsed = toolResultRecordSchema.safeParse(record);
  if (!parsed.success) return [];
  return parsed.data.message.content.flatMap((block) => ("text" in block ? deliveredGuidancePaths(block.text) : []));
}

function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  return typeof value === "string" ? value : "";
}

const PI_TOOL_CATEGORIZERS: Record<string, (args: Record<string, unknown>, acc: BehaviorAccumulator) => void> = {
  read: (args, acc) => {
    const file = stringArg(args, "path");
    if (file) acc.filesRead.push(file);
  },
  ls: (args, acc) => acc.searches.push({ tool: "ls", summary: stringArg(args, "path") || "." }),
  bash: (args, acc) => {
    const command = stringArg(args, "command");
    if (!command) return;
    acc.bashCommands.push(command);
    acc.bashRawCommands.push(command);
    if (shellCommandConsultsFiles(command)) acc.filesRead.push(command);
    if (shellCommandSearches(command)) acc.searches.push({ tool: "bash", summary: command });
  },
};

/** Behavior from a pi session's parsed records, in file order. */
export function piBehaviorFromRecords(records: Iterable<Record<string, unknown>>): AgentBehavior {
  const acc: BehaviorAccumulator = { filesRead: [], searches: [], bashCommands: [], bashRawCommands: [] };
  const responseChunks: string[] = [];
  const replyBlocks: ReplyBlock[] = [];
  const turns: TurnUsage[] = [];
  let replyStart = 0;
  let readsBeforeFirstEdit: number | null = null;
  for (const record of records) {
    acc.filesRead.push(...deliveredIn(record));
    const parsed = assistantRecordSchema.safeParse(record);
    if (!parsed.success) continue;
    const { content, usage } = parsed.data.message;
    if (usage) turns.push({ inputTokens: usage.input, cacheCreationInputTokens: usage.cacheWrite, cacheReadInputTokens: usage.cacheRead });
    for (const block of content) {
      if ("text" in block && block.text) {
        responseChunks.push(block.text);
        replyBlocks.push({ text: block.text, update: false });
      }
      if ("arguments" in block) {
        if (EDIT_TOOLS.has(block.name)) readsBeforeFirstEdit ??= acc.filesRead.length;
        PI_TOOL_CATEGORIZERS[block.name]?.(block.arguments, acc);
        replyStart = replyBlocks.length;
      }
    }
  }
  const responseText = responseChunks.join("\n").trim();
  return {
    ...acc,
    responseText,
    replyText: visibleReplyText(replyBlocks, replyStart),
    responseLength: responseText.split(/\s+/).filter(Boolean).length,
    context: summarizeContextUsage(turns),
    readsBeforeFirstEdit,
  };
}

/** Behavior from the pi session the audit ran; throws when pi wrote no session file. */
export async function piBehaviorFromSession(boxRoot: string, sessionId: string): Promise<AgentBehavior> {
  const file = await findPiSessionFile(boxRoot, sessionId);
  if (file === null) throw new KnowledgeAuditTranscriptError({ engine: "pi", sessionId, logPath: piSessionsDir(boxRoot) });
  const records: Array<Record<string, unknown>> = [];
  for await (const { raw } of piLines(file)) records.push(raw);
  return piBehaviorFromRecords(records);
}
