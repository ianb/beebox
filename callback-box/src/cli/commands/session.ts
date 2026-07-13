/**
 * cb session - View Claude Code session transcripts.
 *
 * Renders a compact, human-readable view of a session log:
 * - Shows what files the agent read, wrote, edited
 * - Shows bash command descriptions (not the commands themselves)
 * - Skips tool results (we care about behavior, not output)
 * - Shows text responses from the agent
 *
 * Discovery spans every context root — the box root plus each landmark
 * subdirectory whose sessions the history file knows about — and running
 * the command from inside a landmark dir favors that dir's sessions
 * (ordering only, never filtering).
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { requireBoxRoot } from "../../lib/paths.js";
import {
  findSessionLog,
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
import { invariant } from "../../lib/invariant.js";

/**
 * The box-relative directory the command was run from ("" when at the box
 * root or outside the box entirely). Non-empty means the user is standing
 * in a landmark subdirectory, and its sessions get ordering affinity.
 */
function cwdContextDir(boxRoot: string): string {
  const rel = path.relative(boxRoot, process.cwd());
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return "";
  return rel;
}

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
      const contextDir = cwdContextDir(boxRoot);

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
        await runListMode({ boxRoot, since, cwdContextDir: contextDir });
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

      let logPath: string;
      if (options.latest) {
        // --latest: the newest session bound to the current landmark dir
        // when run from one, else the newest anywhere.
        const sessions = await listSessions(boxRoot);
        if (sessions.length === 0) {
          console.error("No sessions found for this box.");
          process.exit(1);
        }
        const peer =
          contextDir !== ""
            ? sessions.find((s) => s.contextDir === contextDir)
            : undefined;
        const [newest] = sessions;
        invariant(newest !== undefined, "sessions must be non-empty (checked above)");
        const chosen = peer ?? newest;
        console.log(
          peer
            ? `Latest session in ${contextDir} (use --list for all):`
            : "Latest session (use --list for all):"
        );
        sessionId = chosen.sessionId;
        logPath = chosen.path;
      } else {
        if (!sessionId) {
          console.error(
            "Please provide a session ID, or use --latest, --list, or --since."
          );
          process.exit(1);
        }
        const found = await findSessionLog(boxRoot, sessionId);
        if (!found.ok) {
          console.error(`Session log not found for id: ${sessionId}`);
          console.error("Searched:");
          for (const dir of found.error) console.error(`  ${dir}`);
          process.exit(1);
        }
        logPath = found.value;
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
