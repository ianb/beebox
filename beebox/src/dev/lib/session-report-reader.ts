/** Line-oriented parsing for the critique-friendly session report. */

import * as fs from "node:fs";
import * as readline from "node:readline";
import { z } from "zod";
import { type KnownToolName, isKnownTool } from "../../shared/known-tools.js";

const rawBlockSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  thinking: z.string().optional(),
  name: z.string().optional(),
  id: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  tool_use_id: z.string().optional(),
  content: z.unknown().optional(),
});
type RawBlock = z.infer<typeof rawBlockSchema>;

const sessionLineSchema = z.object({
  type: z.string().optional(),
  message: z.object({ content: z.unknown().optional() }).optional(),
});

const resultTextBlockSchema = z.object({ type: z.literal("text"), text: z.string() });

export interface ToolCall {
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;
  description: string;
  output: string | null;
}

export interface ReportEntry {
  role: "user" | "assistant";
  text: string | null;
  toolCalls: ToolCall[];
}

interface RawEntry {
  type: string;
  content: RawBlock[];
}

export interface ReportStats {
  entries: number;
  userTurns: number;
  assistantTurns: number;
  bashCalls: number;
  readCalls: number;
  toolCalls: number;
}

/** Stream normalized entries while retaining only the current JSONL line. */
async function* readRawEntries(logPath: string): AsyncGenerator<RawEntry> {
  const fileStream = fs.createReadStream(logPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(line);
    } catch (_e) {
      continue;
    }
    const parsed = sessionLineSchema.safeParse(parsedLine);
    if (!parsed.success) continue;
    const { type, message } = parsed.data;
    if (type !== "user" && type !== "assistant") continue;
    if (!message) continue;

    const content = message.content;
    const blocks: RawBlock[] = typeof content === "string"
      ? [{ type: "text", text: content }]
      : Array.isArray(content)
        ? content.flatMap((candidate) => {
            const block = rawBlockSchema.safeParse(candidate);
            return block.success ? [block.data] : [];
          })
        : [];
    yield { type, content: blocks };
  }
}

function buildUserEntry(blocks: RawBlock[]): ReportEntry | null {
  const textBlocks = blocks.filter((block) =>
    block.type === "text" && block.text && block.text.trim()
  );
  if (textBlocks.length === 0) return null;
  const text = textBlocks.map((block) => block.text || "").join("\n").trim();
  return { role: "user", text, toolCalls: [] };
}

function buildAssistantEntry(blocks: RawBlock[]): ReportEntry | null {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of blocks) {
    if (block.type === "text" && block.text && block.text.trim()) {
      textParts.push(block.text.trim());
    }
    if (block.type === "tool_use" && block.name && block.id) {
      const input = block.input || {};
      toolCalls.push({
        toolName: block.name,
        toolId: block.id,
        input,
        description: describeToolCall(block.name, input),
        output: null,
      });
    }
  }

  const text = textParts.length > 0 ? textParts.join("\n\n") : null;
  return text || toolCalls.length > 0
    ? { role: "assistant", text, toolCalls }
    : null;
}

function extractResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((candidate: unknown) => {
      if (typeof candidate === "string") return candidate;
      const block = resultTextBlockSchema.safeParse(candidate);
      return block.success ? block.data.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function attachToolResults(blocks: RawBlock[], assistant: ReportEntry): boolean {
  let sawResult = false;
  for (const block of blocks) {
    if (block.type !== "tool_result" || !block.tool_use_id) continue;
    sawResult = true;
    const call = assistant.toolCalls.find((candidate) => candidate.toolId === block.tool_use_id);
    if (call) call.output = extractResultText(block.content) || null;
  }
  return sawResult;
}

/** Stream reportable entries while retaining at most one tool-use exchange. */
export async function* readReportEntries(logPath: string): AsyncGenerator<ReportEntry> {
  let pendingAssistant: ReportEntry | null = null;

  for await (const rawEntry of readRawEntries(logPath)) {
    if (rawEntry.type === "assistant") {
      if (pendingAssistant) yield pendingAssistant;
      const assistant = buildAssistantEntry(rawEntry.content);
      if (!assistant) {
        pendingAssistant = null;
      } else if (assistant.toolCalls.length > 0) {
        pendingAssistant = assistant;
      } else {
        pendingAssistant = null;
        yield assistant;
      }
      continue;
    }

    const user = buildUserEntry(rawEntry.content);
    const sawResult = pendingAssistant
      ? attachToolResults(rawEntry.content, pendingAssistant)
      : false;
    if (pendingAssistant && (sawResult || user)) {
      yield pendingAssistant;
      pendingAssistant = null;
    }
    if (user) yield user;
  }

  if (pendingAssistant) yield pendingAssistant;
}

/** First-pass counts for the report header, without retaining report entries. */
export async function scanReportStats(logPath: string): Promise<ReportStats> {
  const stats: ReportStats = {
    entries: 0,
    userTurns: 0,
    assistantTurns: 0,
    bashCalls: 0,
    readCalls: 0,
    toolCalls: 0,
  };

  for await (const rawEntry of readRawEntries(logPath)) {
    const entry = rawEntry.type === "user"
      ? buildUserEntry(rawEntry.content)
      : buildAssistantEntry(rawEntry.content);
    if (!entry) continue;
    stats.entries += 1;
    if (entry.role === "user") {
      stats.userTurns += 1;
      continue;
    }
    stats.assistantTurns += 1;
    for (const call of entry.toolCalls) {
      stats.toolCalls += 1;
      if (call.toolName === "Bash") stats.bashCalls += 1;
      if (call.toolName === "Read") stats.readCalls += 1;
    }
  }
  return stats;
}

const TOOL_CALL_DESCRIBERS: Partial<
  Record<KnownToolName, (input: Record<string, unknown>) => string>
> = {
  Read: (input) => `Read ${input.file_path || ""}`,
  Write: (input) => `Write ${input.file_path || ""} (${String(input.content || "").length} chars)`,
  Edit: (input) => `Edit ${input.file_path || ""}`,
  Bash: (input) => String(input.command || input.description || ""),
  Glob: (input) => `Glob ${input.pattern || ""}`,
  Grep: (input) => `Grep "${input.pattern || ""}" in ${input.path || "."}`,
  TodoWrite: () => "TodoWrite",
  Task: (input) => `Task: ${String(input.description || "").substring(0, 120)}`,
};

function describeToolCall(name: string, input: Record<string, unknown>): string {
  if (isKnownTool(name)) {
    const describe = TOOL_CALL_DESCRIBERS[name];
    if (describe) return describe(input);
  }
  return `${name}: ${JSON.stringify(input).substring(0, 150)}`;
}
