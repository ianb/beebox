/**
 * Mode handlers for `cb session`.
 *
 * The command dispatches to one of several modes: `--list`, `--since`
 * (windowed multi-session view), and the single-session view (`--latest`,
 * explicit ID). Each mode's logic lives here so the command's action stays a
 * thin dispatcher. `--since` parsing also lives here since both `--list` and
 * the windowed view consume the resulting cutoff.
 */

import * as fs from "node:fs";
import {
  listSessions,
  parseSessionLog,
  type SessionMetadata,
} from "../lib/session.js";
import { generateSessionReport } from "../../dev/lib/session-report.js";
import { parseDuration } from "../../schemas/scheduled-script.js";
import {
  printListRow,
  sessionDivider,
  sessionDividerForWindow,
  enrichSessions,
} from "./session-format.js";
import { renderEntries, type RenderOptions } from "./session-render.js";
import { invariant } from "../../lib/invariant.js";

export interface SinceWindow {
  cutoff: number;
  label: string;
}

/**
 * Resolve `--since <when>` into a cutoff timestamp + human label. Tries a
 * duration (30m, 1d, 2w) first, then falls back to an ISO timestamp. Calls
 * `process.exit(1)` with an explanatory message on an invalid value.
 */
export function resolveSince(since: string): SinceWindow {
  try {
    return {
      cutoff: Date.now() - parseDuration(since),
      label: `the last ${since}`,
    };
  } catch (_e) {
    // Not a duration like "1d"/"30m": fall back to parsing as an ISO
    // timestamp. The duration parse error is expected here and carries no
    // info the ISO fallback needs; an invalid ISO value is reported
    // explicitly with its own error message.
    const parsed = new Date(since);
    if (isNaN(parsed.getTime())) {
      console.error(
        `Invalid --since value: "${since}". Use a duration like "1d" or an ISO timestamp like "2026-04-17T08:00:00Z".`
      );
      process.exit(1);
    }
    return { cutoff: parsed.getTime(), label: parsed.toISOString() };
  }
}

/** Sessions whose last event is at or after the cutoff, in the given order. */
function sessionsInWindow(
  enriched: SessionMetadata[],
  { cutoff, order }: { cutoff: number; order: "oldest-first" | "newest-first" }
): SessionMetadata[] {
  const dir = order === "oldest-first" ? 1 : -1;
  return enriched
    .filter((m) => m.endTime !== null && m.endTime.getTime() >= cutoff)
    .toSorted((a, b) => {
      const at = a.startTime?.getTime() || 0;
      const bt = b.startTime?.getTime() || 0;
      return (at - bt) * dir;
    });
}

/** `--list`: print recent sessions, optionally filtered to a `--since` window. */
export async function runListMode(options: {
  boxRoot: string;
  since: SinceWindow | null;
}): Promise<void> {
  const { boxRoot, since } = options;
  const allSessions = await listSessions(boxRoot);
  if (allSessions.length === 0) {
    console.log("No sessions found for this box.");
    return;
  }

  // Pre-filter by mtime when possible: a session whose file mtime is older
  // than the cutoff can't have any activity inside the window.
  const prefiltered = since
    ? allSessions.filter((s) => s.mtime.getTime() >= since.cutoff)
    : allSessions.slice(0, 20);

  const enriched = await enrichSessions(prefiltered);

  // A session is in-window if any of its activity is recent enough — i.e. its
  // last event is at or after the cutoff. This catches long-running sessions
  // that started before the window but continued into it.
  const sorted = since
    ? sessionsInWindow(enriched, { cutoff: since.cutoff, order: "newest-first" })
    : enriched.toSorted((a, b) => {
        const at = a.startTime?.getTime() || 0;
        const bt = b.startTime?.getTime() || 0;
        return bt - at;
      });

  if (sorted.length === 0) {
    console.log(
      since
        ? `No sessions with activity since ${since.label}.`
        : "No sessions found for this box."
    );
    return;
  }

  console.log(
    since
      ? `Sessions with activity since ${since.label}:\n`
      : "Recent sessions:\n"
  );
  for (const meta of sorted) {
    printListRow(meta);
  }
}

/** Print one windowed session in the active output mode (raw/report/render). */
async function renderWindowedSession(options: {
  meta: SessionMetadata;
  since: SinceWindow;
  renderOptions: RenderOptions;
  raw: boolean;
  toolReport: boolean;
}): Promise<void> {
  const { meta, since, renderOptions, raw, toolReport } = options;
  if (raw) {
    process.stdout.write(fs.readFileSync(meta.path, "utf-8"));
    return;
  }
  if (toolReport) {
    console.log(sessionDivider(meta));
    console.log();
    const report = await generateSessionReport({ logPath: meta.path });
    process.stdout.write(report);
    return;
  }

  const { entries } = await parseSessionLog({ logPath: meta.path });
  const inWindowEntries = entries.filter((e) => {
    const ts = new Date(e.timestamp);
    return !isNaN(ts.getTime()) && ts.getTime() >= since.cutoff;
  });
  if (inWindowEntries.length === 0) return;

  const firstEntry = inWindowEntries[0];
  const lastEntry = inWindowEntries[inWindowEntries.length - 1];
  invariant(
    firstEntry !== undefined && lastEntry !== undefined,
    "inWindowEntries must be non-empty (checked above)"
  );
  const shownStart = new Date(firstEntry.timestamp);
  const shownEnd = new Date(lastEntry.timestamp);
  console.log(
    sessionDividerForWindow(meta, { start: shownStart, end: shownEnd })
  );
  console.log();
  renderEntries(inWindowEntries, renderOptions);
}

/**
 * `--since` without `--list`: read every session whose activity overlaps the
 * window, oldest-session first, with dividers between them. For formatted
 * render modes, drop entries older than the cutoff so long-running sessions
 * show only the recent messages.
 */
export async function runSinceMode(options: {
  boxRoot: string;
  since: SinceWindow;
  renderOptions: RenderOptions;
  raw: boolean;
  toolReport: boolean;
}): Promise<void> {
  const { boxRoot, since, renderOptions, raw, toolReport } = options;
  const allSessions = await listSessions(boxRoot);
  const prefiltered = allSessions.filter(
    (s) => s.mtime.getTime() >= since.cutoff
  );
  const enriched = await enrichSessions(prefiltered);
  const inWindow = sessionsInWindow(enriched, {
    cutoff: since.cutoff,
    order: "oldest-first",
  });

  if (inWindow.length === 0) {
    console.log(`No sessions with activity since ${since.label}.`);
    return;
  }

  let first = true;
  for (const meta of inWindow) {
    if (!first) console.log();
    first = false;
    await renderWindowedSession({
      meta,
      since,
      renderOptions,
      raw,
      toolReport,
    });
  }
}
