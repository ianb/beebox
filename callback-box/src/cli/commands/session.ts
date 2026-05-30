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
  getSessionMetadata,
  listSessions,
  parseSelfNotes,
  parseSessionLog,
  stripSpeechWrappers,
  type SelfNoteInfo,
  type SessionEntry,
  type SessionContentBlock,
  type SessionMetadata,
} from "../lib/session.js";
import { generateSessionReport } from "../../dev/lib/session-report.js";
import { parseDuration } from "../../schemas/scheduled-script.js";

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

interface RenderOptions {
  full: boolean;
  dialogueOnly: boolean;
}

/**
 * If this entry is a pure self-note entry (user-position text composed
 * entirely of one or more `<self-note>` blocks), return all the notes.
 * Otherwise null.
 */
function getSelfNotes(entry: SessionEntry): SelfNoteInfo[] | null {
  if (entry.type !== "user") return null;
  for (const block of entry.content) {
    if (block.type !== "text") continue;
    const notes = parseSelfNotes(block.text || "");
    if (notes) return notes;
  }
  return null;
}

function renderSelfNote(note: SelfNoteInfo, options: RenderOptions): void {
  const separator = "\u2500".repeat(40);
  console.log(`\u2500\u2500 Self-note ${separator}`);
  if (!options.dialogueOnly) {
    if (note.ref) console.log(`  ref:    ${note.ref}`);
    if (note.commit) console.log(`  commit: ${note.commit}`);
    if (note.ref || note.commit) console.log();
  }
  for (const line of note.body.split("\n")) {
    console.log(`  ${line}`);
  }
  console.log();
}

/**
 * Compute the printable lines for one session entry. Returns empty array when
 * the entry would produce no output — caller suppresses the speaker header in
 * that case, which prevents empty `── Assistant ──` blocks.
 */
function computeEntryLines(entry: SessionEntry, options: RenderOptions): string[] {
  const lines: string[] = [];

  for (const block of entry.content) {
    if (block.type === "text") {
      let text = block.text?.trim() || "";
      if (!text) continue;
      if (options.dialogueOnly) {
        text = stripSpeechWrappers(text).replace(/\n{3,}/g, "\n\n").trim();
        if (!text) continue;
      }
      lines.push(text);
    } else if (block.type === "tool_use") {
      if (options.dialogueOnly) continue;
      const line = formatToolUse(block);
      if (line) lines.push(line);
    } else if (block.type === "tool_result") {
      if (options.dialogueOnly) continue;
      if (!options.full) continue;
      const summary = block.resultSummary?.trim();
      if (summary) lines.push(`  \u2514\u2500 ${summary.substring(0, 200)}`);
    }
    // thinking/image blocks: skip
  }

  return lines;
}

/**
 * Render entries with speaker headers emitted only when the entry has
 * content to print — this avoids the empty `── Assistant ──` blocks that
 * appear for thinking-only or TodoWrite-only entries in the JSONL log.
 */
function renderEntries(entries: SessionEntry[], options: RenderOptions): void {
  const separator = "\u2500".repeat(40);

  for (const entry of entries) {
    const notes = getSelfNotes(entry);
    if (notes) {
      for (const note of notes) {
        renderSelfNote(note, options);
      }
      continue;
    }

    const lines = computeEntryLines(entry, options);
    if (lines.length === 0) continue;

    const speaker = entry.type === "user" ? "User" : "Assistant";
    console.log(`\u2500\u2500 ${speaker} ${separator}`);
    for (const line of lines) console.log(line);
    console.log();
  }
}

function formatTimestamp(d: Date): string {
  return d.toISOString().replace("T", " ").substring(0, 16);
}

function formatTimeRange(start: Date | null, end: Date | null): string {
  if (!start) return "(empty)";
  const startStr = formatTimestamp(start);
  if (!end) return startStr;
  const endStr = formatTimestamp(end);
  if (endStr === startStr) return startStr;
  const startDate = startStr.substring(0, 10);
  const endDate = endStr.substring(0, 10);
  if (startDate === endDate) {
    return `${startStr} \u2192 ${endStr.substring(11)}`;
  }
  return `${startStr} \u2192 ${endStr}`;
}

function sessionDivider(meta: SessionMetadata): string {
  const range = formatTimeRange(meta.startTime, meta.endTime);
  return `\u2550\u2550\u2550 Session ${meta.sessionId}  ${range} \u2550\u2550\u2550`;
}

/**
 * Divider for --since mode: shows the range of in-window activity, and notes
 * when the session itself started before the window (so a reader knows this
 * is a continuation rather than a fresh session).
 */
function sessionDividerForWindow(
  meta: SessionMetadata,
  shown: { start: Date; end: Date }
): string {
  const range = formatTimeRange(shown.start, shown.end);
  const started = meta.startTime;
  const isContinuation = started !== null && started.getTime() < shown.start.getTime();
  const suffix = isContinuation
    ? ` (continues from ${formatTimestamp(started!)})`
    : "";
  return `\u2550\u2550\u2550 Session ${meta.sessionId}  ${range}${suffix} \u2550\u2550\u2550`;
}

function printListRow(meta: SessionMetadata): void {
  const id = `${meta.sessionId.substring(0, 12)}...`;
  const range = formatTimeRange(meta.startTime, meta.endTime);
  const stats = `(${meta.userTurns}/${meta.assistantTurns} turns \u00B7 ${meta.toolCount} tools)`;
  console.log(`  ${id}  ${range}  ${stats}`);
  if (meta.firstUserSnippet) {
    console.log(`    "${meta.firstUserSnippet}"`);
  }
}

async function enrichSessions(
  sessions: Array<{ sessionId: string; path: string }>
): Promise<SessionMetadata[]> {
  return Promise.all(
    sessions.map((s) =>
      getSessionMetadata({ sessionId: s.sessionId, logPath: s.path })
    )
  );
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

      // --since is incompatible with an explicit ID or --latest
      if (options.since && (sessionId || options.latest)) {
        console.error(
          "--since cannot be combined with a session ID or --latest. Use one or the other."
        );
        process.exit(1);
      }

      let cutoff: number | null = null;
      let sinceLabel: string | null = null;
      if (options.since) {
        // Try duration first (30m, 1d, 2w). If that fails, fall back to an
        // ISO timestamp (2026-04-17 or 2026-04-17T08:00:00Z).
        try {
          cutoff = Date.now() - parseDuration(options.since);
          sinceLabel = `the last ${options.since}`;
        } catch (_e) {
          // Not a duration like "1d"/"30m": fall back to parsing as an ISO
          // timestamp below. The duration parse error is expected here and
          // carries no info the ISO fallback needs; an invalid ISO value is
          // reported explicitly with its own error message.
          const parsed = new Date(options.since);
          if (isNaN(parsed.getTime())) {
            console.error(
              `Invalid --since value: "${options.since}". Use a duration like "1d" or an ISO timestamp like "2026-04-17T08:00:00Z".`
            );
            process.exit(1);
          }
          cutoff = parsed.getTime();
          sinceLabel = parsed.toISOString();
        }
      }

      const renderOptions: RenderOptions = {
        full: !!options.full,
        dialogueOnly: !!options.dialogueOnly,
      };

      // --list: show recent sessions (enriched)
      if (options.list) {
        const allSessions = await listSessions(boxRoot);
        if (allSessions.length === 0) {
          console.log("No sessions found for this box.");
          return;
        }

        // Pre-filter by mtime when possible: a session whose file mtime is
        // older than the cutoff can't have any activity inside the window.
        const prefiltered =
          cutoff !== null
            ? allSessions.filter((s) => s.mtime.getTime() >= cutoff)
            : allSessions.slice(0, 20);

        const enriched = await enrichSessions(prefiltered);

        // A session is in-window if any of its activity is recent enough —
        // i.e. its last event is at or after the cutoff. This catches
        // long-running sessions that started before the window but continued
        // into it.
        const filtered =
          cutoff !== null
            ? enriched.filter(
                (m) => m.endTime !== null && m.endTime.getTime() >= cutoff
              )
            : enriched;

        const sorted = filtered.toSorted((a, b) => {
          const at = a.startTime?.getTime() || 0;
          const bt = b.startTime?.getTime() || 0;
          return bt - at;
        });

        if (sorted.length === 0) {
          if (cutoff !== null) {
            console.log(`No sessions with activity since ${sinceLabel}.`);
          } else {
            console.log("No sessions found for this box.");
          }
          return;
        }

        console.log(
          cutoff !== null
            ? `Sessions with activity since ${sinceLabel}:\n`
            : "Recent sessions:\n"
        );
        for (const meta of sorted) {
          printListRow(meta);
        }
        return;
      }

      // --since without --list: read all sessions whose activity overlaps the
      // window (any entry on or after the cutoff), oldest-session first, with
      // session-boundary dividers between them. For formatted render modes,
      // drop entries older than the cutoff so long-running sessions show only
      // the recent messages — matching the "catch up on what's new" intent.
      if (cutoff !== null) {
        const allSessions = await listSessions(boxRoot);
        const prefiltered = allSessions.filter(
          (s) => s.mtime.getTime() >= cutoff
        );
        const enriched = await enrichSessions(prefiltered);
        const inWindow = enriched
          .filter((m) => m.endTime !== null && m.endTime.getTime() >= cutoff)
          .toSorted((a, b) => {
            const at = a.startTime?.getTime() || 0;
            const bt = b.startTime?.getTime() || 0;
            return at - bt; // oldest first
          });

        if (inWindow.length === 0) {
          console.log(`No sessions with activity since ${sinceLabel}.`);
          return;
        }

        let first = true;
        for (const meta of inWindow) {
          if (!first) console.log();
          first = false;
          if (options.raw) {
            const content = fs.readFileSync(meta.path, "utf-8");
            process.stdout.write(content);
            continue;
          }
          if (options.toolReport) {
            console.log(sessionDivider(meta));
            console.log();
            const report = await generateSessionReport({ logPath: meta.path });
            process.stdout.write(report);
            continue;
          }

          const { entries } = await parseSessionLog({ logPath: meta.path });
          const inWindowEntries = entries.filter((e) => {
            const ts = new Date(e.timestamp);
            return !isNaN(ts.getTime()) && ts.getTime() >= cutoff;
          });
          if (inWindowEntries.length === 0) continue;

          const shownStart = new Date(inWindowEntries[0]!.timestamp);
          const shownEnd = new Date(
            inWindowEntries[inWindowEntries.length - 1]!.timestamp
          );
          console.log(
            sessionDividerForWindow(meta, { start: shownStart, end: shownEnd })
          );
          console.log();
          renderEntries(inWindowEntries, renderOptions);
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
