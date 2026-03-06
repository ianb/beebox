/**
 * cb session - View Claude Code session transcripts.
 *
 * Renders a compact, human-readable view of a session log:
 * - Shows what files the agent read, wrote, edited
 * - Shows bash command descriptions (not the commands themselves)
 * - Skips tool results (we care about behavior, not output)
 * - Shows text responses from the agent
 */

import { Command } from "commander";
import * as fs from "node:fs";
import { requireBoxRoot } from "../lib/paths.js";
import {
  getSessionLogPath,
  listSessions,
  parseSessionLog,
  type SessionEntry,
  type SessionContentBlock,
} from "../lib/session.js";
import { generateSessionReport } from "../../dev/lib/session-report.js";

/**
 * Format a tool_use block as a compact one-liner.
 * Returns null to skip the block entirely.
 */
function formatToolUse(block: SessionContentBlock): string | null {
  const name = block.toolName || "";
  const input = block.input || {};

  switch (name) {
    case "Read":
      return `  \u{1F4C2} Read ${input.file_path || ""}`;
    case "Write": {
      const chars = String(input.content || "").length;
      return `  \u{1F4DD} Write ${input.file_path || ""} (${chars} chars)`;
    }
    case "Edit":
      return `  \u{270F}\u{FE0F} Edit ${input.file_path || ""}`;
    case "Bash":
      return `  \u{1F4BB} ${input.description || block.inputSummary || ""}`;
    case "Glob":
      return `  \u{1F4C2} Glob ${input.pattern || ""}`;
    case "Grep":
      return `  \u{1F50D} Grep ${input.pattern || ""} in ${input.path || "."}`;
    case "Task":
      return `  \u{1F500} Task: ${input.description || ""}`;
    case "TodoWrite":
      return null; // skip
    case "WebFetch":
      return `  \u{1F310} Fetch ${input.url || ""}`;
    case "WebSearch":
      return `  \u{1F50D} Search "${input.query || ""}"`;
    default:
      return `  \u{1F527} ${name} ${block.inputSummary || ""}`;
  }
}

/**
 * Render a session entry to the console.
 */
function renderEntry(entry: SessionEntry, showResults: boolean): void {
  const label = entry.type === "user" ? "User" : "Assistant";
  const separator = "\u2500".repeat(40);
  console.log(`\u2500\u2500 ${label} ${separator}`);

  for (const block of entry.content) {
    if (block.type === "text") {
      const text = block.text?.trim();
      if (text) console.log(text);
    } else if (block.type === "tool_use") {
      const line = formatToolUse(block);
      if (line) console.log(line);
    } else if (block.type === "tool_result" && showResults) {
      const summary = block.resultSummary?.trim();
      if (summary) {
        console.log(`  \u2514\u2500 ${summary.substring(0, 200)}`);
      }
    }
    // tool_result without --full: skip
  }

  console.log();
}

export const sessionCommand = new Command("session")
  .description("View a Claude Code session transcript")
  .argument("[session-id]", "Session ID to view")
  .option("--latest", "Show the most recent session")
  .option("--list", "List recent sessions")
  .option("--full", "Show tool results too")
  .option("--tool-report", "Generate critique-friendly report (includes Bash output)")
  .option("--raw", "Dump raw JSONL")
  .action(
    async (
      sessionId: string | undefined,
      options: {
        latest?: boolean;
        list?: boolean;
        full?: boolean;
        toolReport?: boolean;
        raw?: boolean;
      }
    ) => {
      const boxRoot = await requireBoxRoot();

      // --list: show recent sessions
      if (options.list) {
        const sessions = await listSessions(boxRoot);
        if (sessions.length === 0) {
          console.log("No sessions found for this box.");
          return;
        }
        console.log("Recent sessions:\n");
        for (const s of sessions.slice(0, 20)) {
          const date = s.mtime.toISOString().replace("T", " ").substring(0, 19);
          console.log(`  ${s.sessionId}  ${date}`);
        }
        return;
      }

      // --latest: find most recent session
      if (options.latest) {
        const sessions = await listSessions(boxRoot);
        if (sessions.length === 0) {
          console.error("No sessions found for this box.");
          process.exit(1);
        }
        sessionId = sessions[0]!.sessionId;
      }

      if (!sessionId) {
        console.error(
          "Please provide a session ID, or use --latest or --list."
        );
        process.exit(1);
      }

      const logPath = getSessionLogPath(boxRoot, sessionId);

      if (!fs.existsSync(logPath)) {
        console.error(`Session log not found: ${logPath}`);
        process.exit(1);
      }

      // --raw: dump the file
      if (options.raw) {
        const content = fs.readFileSync(logPath, "utf-8");
        process.stdout.write(content);
        return;
      }

      // --tool-report: generate critique-friendly report
      if (options.toolReport) {
        const report = await generateSessionReport({ logPath });
        process.stdout.write(report);
        return;
      }

      // Parse and render
      console.log(`Session: ${sessionId}\n`);

      const { entries } = await parseSessionLog({ logPath });

      if (entries.length === 0) {
        console.log("(empty session)");
        return;
      }

      for (const entry of entries) {
        renderEntry(entry, !!options.full);
      }
    }
  );
