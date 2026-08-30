/**
 * bbx session - View native agent session transcripts.
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
import { pipeline } from "node:stream/promises";
import * as path from "node:path";
import { requireBoxRoot } from "../../lib/paths.js";
import {
  findSessionLog,
  listSessions,
  MAX_SESSION_ENTRIES,
  parseSessionLog,
} from "../lib/session.js";
import { writeSessionReport } from "../../dev/lib/session-report.js";
import { renderEntries, type RenderOptions } from "./session-render.js";
import {
  partitionByAffinity,
  resolveSince,
  runListMode,
  runSinceMode,
  sessionEntriesPrintable,
  transcriptPrintable,
  type SinceWindow,
} from "./session-modes.js";
import { invariant } from "../../lib/invariant.js";
import { readCodexSessionHistory } from "../../core/chat/session/codex-transcript.js";
import {
  parseDiagnosticEngine,
  resolveDiagnosticEngine,
  validateCodexSessionMode,
} from "../lib/diagnostic-session.js";
import type { AgentEngine } from "../../core/box/config.js";

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

function requestedSessionEngine(value: string | undefined): AgentEngine | undefined {
  if (value === undefined) return undefined;
  try {
    return parseDiagnosticEngine(value);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function explicitSessionLogPath(options: {
  boxRoot: string;
  sessionId: string;
  requestedEngine: AgentEngine | undefined;
  raw: boolean;
  toolReport: boolean;
  full: boolean;
  allowHuge: boolean;
  renderOptions: RenderOptions;
}): Promise<string | null> {
  const engine = await resolveDiagnosticEngine({
    boxRoot: options.boxRoot,
    sessionId: options.sessionId,
    requestedEngine: options.requestedEngine,
    // TODO(env-migration): native harness identity inherited only by this command path.
    codexThreadId: process.env["CODEX_THREAD_ID"],
  });
  if (engine === "claude") {
    const found = await findSessionLog(options.boxRoot, options.sessionId);
    if (found.ok) return found.value;
    console.error(`Session log not found for id: ${options.sessionId}`);
    console.error("Searched:");
    for (const dir of found.error) console.error(`  ${dir}`);
    process.exit(1);
  }

  try {
    validateCodexSessionMode({
      raw: options.raw,
      toolReport: options.toolReport,
      full: options.full,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const { entries, total } = await readCodexSessionHistory({
    boxRoot: options.boxRoot,
    sessionId: options.sessionId,
    slice: { mode: "page", offset: 0, limit: MAX_SESSION_ENTRIES },
  });
  if (!sessionEntriesPrintable({
    entries,
    sessionId: options.sessionId,
    allowHuge: options.allowHuge,
  })) process.exit(1);
  console.log(`Session: ${options.sessionId} (codex)\n`);
  if (entries.length < total) {
    console.warn(
      `Note: this session has ${String(total)} entries; showing the first ${String(entries.length)}.`,
    );
  }
  if (entries.length === 0) console.log("(empty session)");
  else renderEntries(entries, options.renderOptions);
  return null;
}

function validateSessionOptions(options: {
  sessionId: string | undefined;
  requestedEngine: AgentEngine | undefined;
  latest: boolean;
  list: boolean;
  since: string | undefined;
}): void {
  if (options.requestedEngine === "codex" && (options.list || options.latest || options.since)) {
    console.error("--engine codex currently requires an explicit session ID.");
    process.exit(1);
  }
  if (options.since && (options.sessionId || options.latest)) {
    console.error(
      "--since cannot be combined with a session ID or --latest. Use one or the other."
    );
    process.exit(1);
  }
}

export const sessionCommand = new Command("session")
  .description("View a native agent session transcript")
  .argument("[session-id]", "Session ID to view")
  .option("--latest", "Show the most recent Claude session")
  .option("--list", "List recent Claude sessions")
  .option("--full", "Show tool results too")
  .option("--tool-report", "Generate critique-friendly report (includes Bash output)")
  .option("--raw", "Dump raw JSONL")
  .option("--engine <engine>", "Native session engine: claude or codex")
  .option(
    "--allow-huge",
    "Print even when the transcript exceeds the huge-output threshold"
  )
  .option(
    "--since <when>",
    "Include Claude activity since <when> — a duration (30m, 12h, 1d, 2w) or an ISO timestamp (2026-04-17 or 2026-04-17T08:00:00Z)"
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
        allowHuge?: boolean;
        since?: string;
        dialogueOnly?: boolean;
        engine?: string;
      }
    ) => {
      const boxRoot = await requireBoxRoot();
      const contextDir = cwdContextDir(boxRoot);
      const requestedEngine = requestedSessionEngine(options.engine);
      validateSessionOptions({
        sessionId,
        requestedEngine,
        latest: !!options.latest,
        list: !!options.list,
        since: options.since,
      });

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
          allowHuge: !!options.allowHuge,
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
        const [peer] =
          contextDir !== ""
            ? partitionByAffinity(sessions, contextDir).peers
            : [];
        const [newest] = sessions;
        invariant(newest !== undefined, "sessions must be non-empty (checked above)");
        const chosen = peer ?? newest;
        // The chooser line is for humans reading the rendered view — keep
        // --raw and --tool-report output pure machine output.
        if (!options.raw && !options.toolReport) {
          console.log(
            peer
              ? `Latest session in ${peer.contextDir} (use --list for all):`
              : "Latest session (use --list for all):"
          );
        }
        sessionId = chosen.sessionId;
        logPath = chosen.path;
      } else {
        if (!sessionId) {
          console.error(
            "Please provide a session ID, or use --latest, --list, or --since."
          );
          process.exit(1);
        }
        const resolvedLogPath = await explicitSessionLogPath({
          boxRoot,
          sessionId,
          requestedEngine,
          raw: !!options.raw,
          toolReport: !!options.toolReport,
          full: !!options.full,
          allowHuge: !!options.allowHuge,
          renderOptions,
        });
        if (resolvedLogPath === null) return;
        logPath = resolvedLogPath;
      }

      // Every output mode scales with the transcript; refuse a huge one
      // unless the caller asserted they want it.
      if (
        !transcriptPrintable({
          logPath,
          sessionId,
          allowHuge: !!options.allowHuge,
        })
      ) {
        process.exit(1);
      }

      // --raw: dump the file (streamed — a transcript can exceed the heap)
      if (options.raw) {
        await pipeline(fs.createReadStream(logPath), process.stdout, { end: false });
        return;
      }

      // --tool-report: generate critique-friendly report
      if (options.toolReport) {
        await writeSessionReport({
          logPath,
          rawTranscriptCommand: `bbx session ${sessionId} --raw${options.allowHuge ? " --allow-huge" : ""}`,
        });
        return;
      }

      // Parse and render
      console.log(`Session: ${sessionId}\n`);

      const { entries, total } = await parseSessionLog({
        logPath,
        slice: { mode: "page", offset: 0, limit: MAX_SESSION_ENTRIES },
      });
      if (entries.length < total) {
        console.warn(
          `Note: this session has ${String(total)} entries; showing the first ${String(entries.length)}.`,
        );
      }

      if (entries.length === 0) {
        console.log("(empty session)");
        return;
      }

      renderEntries(entries, renderOptions);
    }
  );
