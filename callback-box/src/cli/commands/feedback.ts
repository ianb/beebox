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
import { boxSlug } from "../../lib/box-slug.js";
import { requireBoxRoot } from "../../lib/paths.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import { slugify } from "../../shared/filename.js";
import { invariant } from "../../lib/invariant.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import {
  findSessionLog,
  listSessions,
  parseSessionLog,
  type SessionEntry,
} from "../lib/session.js";
import {
  codexSessionExists,
  readCodexSessionHistory,
} from "../../core/chat/session/codex-transcript.js";

type FeedbackSession =
  | { engine: "claude"; sessionId: string; logPath: string }
  | { engine: "codex"; sessionId: string };

const MAX_CONTEXT_ENTRIES = 12;

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
): Promise<FeedbackSession | null> {
  const envSessionId = process.env["CLAUDE_CODE_SESSION_ID"];
  if (envSessionId) {
    // History-aware first, then a probe of every context root — a landmark
    // session missing from history would otherwise resolve to the box-root
    // path and silently drop its context. On a total miss, fall through to
    // the newest-session fallback below.
    const found = await findSessionLog(boxRoot, envSessionId);
    if (found.ok) return { engine: "claude", sessionId: envSessionId, logPath: found.value };
  }
  // TODO(env-migration): native harness identity inherited only by this command path.
  const codexThreadId = process.env["CODEX_THREAD_ID"];
  if (codexThreadId) {
    try {
      if (await codexSessionExists(boxRoot, codexThreadId)) {
        return { engine: "codex", sessionId: codexThreadId };
      }
    } catch (error) {
      console.warn(
        `Could not use current Codex session ${codexThreadId}; falling back to Claude history:`,
        error,
      );
    }
  }
  // CLAUDE_CODE_SESSION_ID is not propagated when agents are spawned by the SDK.
  // Fall back to the most recently modified session log across all context roots.
  const sessions = await listSessions(boxRoot);
  const [newest] = sessions;
  if (!newest) return null;
  return { engine: "claude", sessionId: newest.sessionId, logPath: newest.path };
}

async function getSessionContext(
  boxRoot: string,
  session: FeedbackSession | null,
): Promise<string | null> {
  if (!session) return null;

  let entries: SessionEntry[];
  try {
    const result = session.engine === "codex"
      ? await readCodexSessionHistory({
          boxRoot,
          sessionId: session.sessionId,
          slice: { mode: "tail", tail: MAX_CONTEXT_ENTRIES },
        })
      : await parseSessionLog({
          logPath: session.logPath,
          slice: { mode: "tail", tail: MAX_CONTEXT_ENTRIES },
        });
    entries = result.entries.filter(
      (entry) => entry.type === "user" || entry.type === "assistant"
    );
  } catch (e) {
    if (session.engine === "codex" || errnoCode(e) !== "ENOENT") {
      console.warn(
        `Could not read ${session.engine} session ${session.sessionId}, no session context available:`,
        e,
      );
    }
    return null;
  }

  if (entries.length === 0) return null;

  // Take a tail that includes at least 1 user message, up to MAX_CONTEXT_ENTRIES
  const tail: SessionEntry[] = [];
  let userMessageCount = 0;

  for (let i = entries.length - 1; i >= 0 && tail.length < MAX_CONTEXT_ENTRIES; i--) {
    const entry = entries[i];
    invariant(entry !== undefined, `entries[${i}] must exist for 0 <= i < entries.length`);
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
      const slug = slugify(message, { maxLength: 40 });
      const fileName = `${timestamp}-${slug}.md`;
      const feedbackDir = path.join(boxRoot, "config", "feedback");
      const filePath = path.join(feedbackDir, fileName);

      await fs.promises.mkdir(feedbackDir, { recursive: true });

      const session = await resolveSession(boxRoot);
      const serverUrl = process.env["CB_SERVER_URL"] ?? null;
      const context = await getSessionContext(boxRoot, session);

      const lines: string[] = [
        "# Agent Feedback",
        "",
        `**Date:** ${now.toISOString()}`,
        `**Box:** ${await boxSlug(boxRoot)}`,
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

      // One span, not a stage and a commit taken separately: agents call this
      // freely mid-conversation, and a rapid conversation produced a commit
      // storm. `stageAndCommitPaths` takes the box git lock once and keeps
      // another writer from staging between our two halves.
      const relPath = path.relative(boxRoot, filePath);
      await stageAndCommitPaths(boxRoot, {
        paths: [relPath],
        message: `agent feedback: ${message.slice(0, 72)}`,
        trailers: { "Feedback-Source": "agent" },
      });

      process.stdout.write(`Feedback recorded: ${relPath}\n`);
    } catch (error) {
      // Best-effort: feedback shouldn't block work. Note the failure on stderr
      // but exit zero so the agent's task isn't interrupted.
      process.stderr.write(`cb feedback: ${errorMessage(error)}\n`);
    }
  });
