/**
 * cb feedback - Record agent observations about CLI friction or confusing conventions.
 *
 * Silent behind-the-scenes mechanism: writes a file to config/feedback/ and commits it.
 * Agents use this to surface observations about confusing options, odd file placements,
 * unclear error messages, etc. — without interrupting the current task.
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { requireBoxRoot } from "../lib/paths.js";
import { stageFiles, commitPaths } from "../lib/git.js";
import {
  getSessionLogPath,
  listSessions,
  parseSessionLog,
  type SessionEntry,
} from "../lib/session.js";

const MAX_CONTEXT_ENTRIES = 12;

function slugify(text: string, maxLen = 40): string {
  return text
    .toLowerCase()
    .replace(/[^\s\w-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLen);
}

function formatEntry(entry: SessionEntry): string {
  const role = entry.type === "user" ? "User" : "Agent";
  const lines: string[] = [`**${role}** (${entry.timestamp})`];

  for (const block of entry.content) {
    if (block.type === "text" && block.text) {
      const text = block.text.trim();
      if (text) lines.push(text);
    } else if (block.type === "tool_use") {
      const summary = block.inputSummary || block.toolName || "";
      lines.push(`→ ${block.toolName}${summary ? ": " + summary : ""}`);
    }
    // tool_result skipped — adds noise without value
  }

  return lines.join("\n");
}

async function resolveSession(
  boxRoot: string
): Promise<{ sessionId: string; logPath: string } | null> {
  const envSessionId = process.env["CLAUDE_CODE_SESSION_ID"];
  if (envSessionId) {
    return { sessionId: envSessionId, logPath: getSessionLogPath(boxRoot, envSessionId) };
  }
  // CLAUDE_CODE_SESSION_ID is not propagated when agents are spawned by the SDK.
  // Fall back to the most recently modified session log.
  const sessions = await listSessions(boxRoot);
  if (sessions.length === 0) return null;
  const newest = sessions[0]!;
  return { sessionId: newest.sessionId, logPath: newest.path };
}

async function getSessionContext(boxRoot: string): Promise<string | null> {
  const session = await resolveSession(boxRoot);
  if (!session) return null;

  let entries: SessionEntry[];
  try {
    const result = await parseSessionLog({ logPath: session.logPath });
    entries = result.entries;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not parse session log at ${session.logPath}, no session context available:`, e);
    }
    return null;
  }

  if (entries.length === 0) return null;

  // Take a tail that includes at least 1 user message, up to MAX_CONTEXT_ENTRIES
  const tail: SessionEntry[] = [];
  let userMessageCount = 0;

  for (let i = entries.length - 1; i >= 0 && tail.length < MAX_CONTEXT_ENTRIES; i--) {
    const entry = entries[i]!;
    tail.unshift(entry);
    if (entry.type === "user") {
      userMessageCount += 1;
      if (userMessageCount >= 1) break;
    }
  }

  if (tail.length === 0) return null;
  return tail.map(formatEntry).join("\n\n---\n\n");
}

export const feedbackCommand = new Command("feedback")
  .description("Record an observation about CLI friction or confusing conventions")
  .argument("<message>", "The feedback to record")
  .action(async (message: string) => {
    try {
      const boxRoot = await requireBoxRoot();
      const now = new Date();

      const timestamp = now.toISOString().replace(/[.:]/g, "-").slice(0, 19);
      const slug = slugify(message);
      const fileName = `${timestamp}-${slug}.md`;
      const feedbackDir = path.join(boxRoot, "config", "feedback");
      const filePath = path.join(feedbackDir, fileName);

      await fs.promises.mkdir(feedbackDir, { recursive: true });

      const session = await resolveSession(boxRoot);
      const serverUrl = process.env["CB_SERVER_URL"] ?? null;
      const context = await getSessionContext(boxRoot);

      const lines: string[] = [
        "# Agent Feedback",
        "",
        `**Date:** ${now.toISOString()}`,
        `**Box:** ${path.basename(boxRoot)}`,
        `**Box path:** ${boxRoot}`,
        ...(serverUrl ? [`**Server:** ${serverUrl}`] : []),
        ...(session ? [`**Session:** ${session.sessionId}`] : []),
        "",
        "## Feedback",
        "",
        message,
      ];

      if (context) {
        lines.push("", "## Session Context", "", context);
      }

      await fs.promises.writeFile(filePath, lines.join("\n") + "\n", "utf-8");

      const relPath = path.relative(boxRoot, filePath);
      await stageFiles(boxRoot, [relPath]);
      await commitPaths(boxRoot, {
        paths: [relPath],
        message: `agent feedback: ${message.slice(0, 72)}`,
        trailers: { "Feedback-Source": "agent" },
      });

      process.stdout.write(`Feedback recorded: ${relPath}\n`);
    } catch (error) {
      // Silent failure — feedback is best-effort and shouldn't block work
      process.stderr.write(`cb feedback: ${(error as Error).message}\n`);
      process.exit(1);
    }
  });
