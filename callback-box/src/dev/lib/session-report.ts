/**
 * Session report generator — produces a critique-friendly markdown report
 * from a Claude Code session log.
 *
 * Unlike `cb session` which skips tool results, this includes Bash command
 * output so a critique agent can evaluate whether CLI output was helpful.
 */

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

/** One user/assistant line of a Claude Code session JSONL (fields we read). */
const sessionLineSchema = z.object({
  type: z.string().optional(),
  message: z.object({ content: z.unknown().optional() }).optional(),
});

const resultTextBlockSchema = z.object({ type: z.literal("text"), text: z.string() });

interface ToolCall {
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;
  description: string;
  output: string | null;
}

interface ReportEntry {
  role: "user" | "assistant";
  text: string | null;
  toolCalls: ToolCall[];
}

interface RawEntry {
  type: string;
  content: RawBlock[];
}

/**
 * Read a session log file and collect all user/assistant entries in order,
 * normalizing each message's content into an array of blocks.
 */
async function collectRawEntries(logPath: string): Promise<RawEntry[]> {
  const fileStream = fs.createReadStream(logPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const rawEntries: RawEntry[] = [];

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
        ? content.flatMap((b) => {
            const block = rawBlockSchema.safeParse(b);
            return block.success ? [block.data] : [];
          })
        : [];

    rawEntries.push({ type, content: blocks });
  }

  return rawEntries;
}

/**
 * Build a map of tool_use_id → tool_result content from user entries.
 */
function buildResultMap(rawEntries: RawEntry[]): Map<string, string> {
  const resultMap = new Map<string, string>();
  for (const entry of rawEntries) {
    if (entry.type !== "user") continue;
    for (const b of entry.content) {
      if (b.type === "tool_result" && b.tool_use_id) {
        resultMap.set(b.tool_use_id, extractResultText(b.content));
      }
    }
  }
  return resultMap;
}

/**
 * Convert a user entry's blocks into a report entry, or null if it carries no
 * real text (i.e. it's just tool_result plumbing).
 */
function buildUserEntry(blocks: RawBlock[]): ReportEntry | null {
  const textBlocks = blocks.filter((b) => b.type === "text" && b.text && b.text.trim());
  if (textBlocks.length === 0) return null;
  const text = textBlocks.map((b) => b.text || "").join("\n").trim();
  return { role: "user", text, toolCalls: [] };
}

/**
 * Convert an assistant entry's blocks into a report entry, pairing tool_use
 * blocks with their results, or null if it carries neither text nor tool calls.
 */
function buildAssistantEntry(blocks: RawBlock[], resultMap: Map<string, string>): ReportEntry | null {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of blocks) {
    if (block.type === "text" && block.text && block.text.trim()) {
      textParts.push(block.text.trim());
    }
    if (block.type === "tool_use" && block.name && block.id) {
      const input = block.input || {};
      const output = resultMap.get(block.id) || null;
      toolCalls.push({
        toolName: block.name,
        toolId: block.id,
        input,
        description: describeToolCall(block.name, input),
        output,
      });
    }
  }

  const text = textParts.length > 0 ? textParts.join("\n\n") : null;
  if (text || toolCalls.length > 0) {
    return { role: "assistant", text, toolCalls };
  }
  return null;
}

/**
 * Parse a session log into report entries, pairing tool_use with tool_result.
 */
async function parseForReport(logPath: string): Promise<ReportEntry[]> {
  const rawEntries = await collectRawEntries(logPath);
  const resultMap = buildResultMap(rawEntries);

  const report: ReportEntry[] = [];
  for (const entry of rawEntries) {
    const blocks = entry.content;
    const reportEntry = entry.type === "user"
      ? buildUserEntry(blocks)
      : buildAssistantEntry(blocks, resultMap);
    if (reportEntry) report.push(reportEntry);
  }

  return report;
}

function extractResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => {
        if (typeof c === "string") return c;
        const block = resultTextBlockSchema.safeParse(c);
        return block.success ? block.data.text : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Per-tool call descriptions, keyed on the shared tool vocabulary. */
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

/**
 * Render a report entry to markdown lines.
 * For Bash calls, includes full command and output.
 * For other tools, shows a one-liner summary.
 */
function renderEntry(entry: ReportEntry): string {
  const lines: string[] = [];

  if (entry.role === "user") {
    lines.push("## User");
    lines.push("");
    if (entry.text) lines.push(entry.text);
    lines.push("");
    return lines.join("\n");
  }

  // Assistant
  lines.push("## Assistant");
  lines.push("");

  if (entry.text) {
    lines.push(entry.text);
    lines.push("");
  }

  for (const call of entry.toolCalls) {
    if (call.toolName === "Bash") {
      // Full detail for Bash — this is the main thing we're critiquing
      const command = String(call.input.command || "");
      lines.push("### Bash");
      lines.push("```");
      lines.push(`$ ${command}`);
      lines.push("```");
      if (call.output) {
        const trimmed = trimOutput(call.output, 3000);
        lines.push("Output:");
        lines.push("```");
        lines.push(trimmed);
        lines.push("```");
      }
      lines.push("");
    } else if (call.toolName === "Read") {
      lines.push(`- Read \`${call.input.file_path || ""}\``);
    } else if (call.toolName === "Write") {
      lines.push(`- Write \`${call.input.file_path || ""}\` (${String(call.input.content || "").length} chars)`);
    } else if (call.toolName === "Edit") {
      lines.push(`- Edit \`${call.input.file_path || ""}\``);
    } else if (call.toolName === "Glob" || call.toolName === "Grep") {
      lines.push(`- ${call.description}`);
      if (call.output) {
        const summary = call.output.split("\n").slice(0, 5).join("\n");
        if (summary.trim()) {
          lines.push(`  \`\`\`\n  ${summary}\n  \`\`\``);
        }
      }
    } else if (call.toolName === "TodoWrite") {
      // Skip — not interesting for critique
    } else {
      lines.push(`- ${call.description}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function trimOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  const omitted = text.length - maxChars;
  return text.substring(0, half) + `\n\n... (${omitted} chars omitted) ...\n\n` + text.substring(text.length - half);
}

export interface GenerateReportOptions {
  logPath: string;
}

/**
 * Generate a critique-friendly markdown report from a session log.
 */
export async function generateSessionReport(options: GenerateReportOptions): Promise<string> {
  const entries = await parseForReport(options.logPath);

  if (entries.length === 0) {
    return "# Session Report\n\n(empty session)\n";
  }

  const lines: string[] = [];
  lines.push("# Session Report");
  lines.push("");

  // Quick stats
  const userTurns = entries.filter((e) => e.role === "user").length;
  const assistantTurns = entries.filter((e) => e.role === "assistant").length;
  const bashCalls = entries.flatMap((e) => e.toolCalls).filter((c) => c.toolName === "Bash").length;
  const readCalls = entries.flatMap((e) => e.toolCalls).filter((c) => c.toolName === "Read").length;

  lines.push(`**Turns:** ${userTurns} user, ${assistantTurns} assistant`);
  lines.push(`**Tool calls:** ${bashCalls} Bash, ${readCalls} Read, ${entries.flatMap((e) => e.toolCalls).length} total`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const entry of entries) {
    lines.push(renderEntry(entry));
  }

  return lines.join("\n");
}
