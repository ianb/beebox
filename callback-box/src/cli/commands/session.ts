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
} from "../lib/session.js";
import { generateSessionReport } from "../../dev/lib/session-report.js";
import { renderEntries, type RenderOptions } from "./session-render.js";
import {
  resolveSince,
  runListMode,
  runSinceMode,
  type SinceWindow,
} from "./session-modes.js";

export const sessionCommand = new Command("session")
  .description("View a Claude Code session transcript")
  .argument("[session-id]", "Session ID to view")
  .option("--latest", "Show the most recent session")
  .option("--list", "List recent sessions")
  .option("--full", "Show tool results too")
  .option("--tool-report", "Generate critique-friendly report (includes Bash output)")
  .option("--raw", "Dump raw JSONL")
  .option(
    "--since <when>",
    "Include activity since <when> — a duration (30m, 12h, 1d, 2w) or an ISO timestamp (2026-04-17 or 2026-04-17T08:00:00Z)"
  )
  .option(
    "--dialogue-only",
    "Strip tool calls and voice-direction metadata; keep just the conversation"
  )
  .action(
    async (
      sessionId: string | undefined,
      options: {
        latest?: boolean;
        list?: boolean;
        full?: boolean;
        toolReport?: boolean;
        raw?: boolean;
        since?: string;
        dialogueOnly?: boolean;
      }
    ) => {
      const boxRoot = await requireBoxRoot();

      // --since is incompatible with an explicit ID or --latest
      if (options.since && (sessionId || options.latest)) {
        console.error(
          "--since cannot be combined with a session ID or --latest. Use one or the other."
        );
        process.exit(1);
      }

      const since: SinceWindow | null = options.since
        ? resolveSince(options.since)
        : null;

      const renderOptions: RenderOptions = {
        full: !!options.full,
        dialogueOnly: !!options.dialogueOnly,
      };

      // --list: show recent sessions (enriched)
      if (options.list) {
        await runListMode({ boxRoot, since });
        return;
      }

      // --since without --list: windowed multi-session view.
      if (since) {
        await runSinceMode({
          boxRoot,
          since,
          renderOptions,
          raw: !!options.raw,
          toolReport: !!options.toolReport,
        });
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
          "Please provide a session ID, or use --latest, --list, or --since."
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

      renderEntries(entries, renderOptions);
    }
  );
