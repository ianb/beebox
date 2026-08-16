/**
 * Session report generator — produces a critique-friendly markdown report
 * from a Claude Code session log.
 *
 * Unlike `cb session` which skips tool results, this includes Bash command
 * output so a critique agent can evaluate whether CLI output was helpful.
 */

import { once } from "node:events";
import {
  readReportEntries,
  scanReportStats,
  type ReportEntry,
} from "./session-report-reader.js";

/**
 * Render a report entry to markdown lines.
 * For Bash calls, includes full command and output.
 * For other tools, shows a one-liner summary.
 */
function renderEntry(entry: ReportEntry): { markdown: string; abbreviated: boolean } {
  const lines: string[] = [];
  let abbreviated = false;

  if (entry.role === "user") {
    lines.push("## User");
    lines.push("");
    if (entry.text) lines.push(entry.text);
    lines.push("");
    return { markdown: lines.join("\n"), abbreviated };
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
        abbreviated ||= call.output.length > 3000;
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
        const outputLines = call.output.split("\n");
        abbreviated ||= outputLines.length > 5;
        const summary = outputLines.slice(0, 5).join("\n");
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
  return { markdown: lines.join("\n"), abbreviated };
}

function trimOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  const omitted = text.length - maxChars;
  return text.substring(0, half) + `\n\n... (${omitted} chars omitted) ...\n\n` + text.substring(text.length - half);
}

export interface WriteReportOptions {
  logPath: string;
  write?: ((chunk: string) => void | Promise<void>) | undefined;
  rawTranscriptCommand?: string | undefined;
}

async function writeStdout(chunk: string): Promise<void> {
  if (!process.stdout.write(chunk)) await once(process.stdout, "drain");
}

/**
 * Write a critique-friendly markdown report without materializing the
 * transcript or completed report. The first pass computes header counts; the
 * second emits one report entry at a time and awaits writer backpressure.
 */
export async function writeSessionReport(options: WriteReportOptions): Promise<void> {
  const write = options.write ?? writeStdout;
  const stats = await scanReportStats(options.logPath);
  if (stats.entries === 0) {
    await write("# Session Report\n\n(empty session)\n");
    return;
  }

  await write(
    "# Session Report\n\n" +
      `**Turns:** ${String(stats.userTurns)} user, ${String(stats.assistantTurns)} assistant\n` +
      `**Tool calls:** ${String(stats.bashCalls)} Bash, ${String(stats.readCalls)} Read, ${String(stats.toolCalls)} total\n\n` +
      "---\n\n",
  );

  let first = true;
  let abbreviated = false;
  for await (const entry of readReportEntries(options.logPath)) {
    if (!first) await write("\n");
    first = false;
    const rendered = renderEntry(entry);
    abbreviated ||= rendered.abbreviated;
    await write(rendered.markdown);
  }

  if (abbreviated) {
    const rawCommand = options.rawTranscriptCommand ?? "cb session <id> --raw";
    await write(
      "\n---\n\n" +
        "Note: Some tool output was abbreviated. " +
        `Run \`${rawCommand}\` to inspect the full transcript.\n`,
    );
  }
}
