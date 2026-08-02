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
import { pipeline } from "node:stream/promises";
import {
  listSessions,
  MAX_SESSION_ENTRIES,
  parseSessionLog,
} from "../lib/session.js";
import { listSessionRoots } from "../../core/chat/session/history.js";
import { generateSessionReport } from "../../dev/lib/session-report.js";
import { parseDuration } from "../../schemas/scheduled-script.js";
import {
  printListRow,
  sessionDivider,
  sessionDividerForWindow,
  enrichSessions,
  type EnrichedSession,
} from "./session-format.js";
import { fmt } from "../../lib/format.js";
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
  enriched: EnrichedSession[],
  { cutoff, order }: { cutoff: number; order: "oldest-first" | "newest-first" }
): EnrichedSession[] {
  const dir = order === "oldest-first" ? 1 : -1;
  return enriched
    .filter((m) => m.endTime !== null && m.endTime.getTime() >= cutoff)
    .toSorted((a, b) => {
      const at = a.startTime?.getTime() || 0;
      const bt = b.startTime?.getTime() || 0;
      return (at - bt) * dir;
    });
}

/**
 * A session is an affinity peer of the cwd's box-relative dir when it's
 * bound to that dir itself OR to an ancestor of it (a chat bound to
 * `store` is relevant when standing in `store/bunker`). Root-bound
 * sessions ("") are peers only at the box root — where affinity is off
 * anyway. This is about recorded session bindings, not landmark cards.
 */
function isAffinityPeer(sessionContextDir: string, cwdContextDir: string): boolean {
  return (
    sessionContextDir === cwdContextDir ||
    (sessionContextDir !== "" && cwdContextDir.startsWith(sessionContextDir + "/"))
  );
}

/**
 * Split sessions into affinity peers of `cwdContextDir` and the rest.
 * Peers come back deepest binding first (exact dir before ancestors),
 * preserving the input's recency order within a depth; `others` keeps
 * the input order untouched. Pass sessions newest-first.
 */
export function partitionByAffinity<T extends { contextDir: string }>(
  sessions: T[],
  cwdContextDir: string
): { peers: T[]; others: T[] } {
  const peers = sessions.filter((s) => isAffinityPeer(s.contextDir, cwdContextDir));
  const others = sessions.filter((s) => !isAffinityPeer(s.contextDir, cwdContextDir));
  const depth = (dir: string): number => (dir === "" ? 0 : dir.split("/").length);
  // toSorted is stable, so equal depths keep the caller's recency order.
  return {
    peers: peers.toSorted((a, b) => depth(b.contextDir) - depth(a.contextDir)),
    others,
  };
}

/** One-line footer telling the reader how wide the discovery sweep was. */
async function printSearchedRootsFooter(boxRoot: string): Promise<void> {
  const roots = await listSessionRoots(boxRoot);
  const landmarks = roots.length - 1;
  console.log(
    fmt.dim(
      `Searched ${roots.length} project dir${roots.length === 1 ? "" : "s"} ` +
        `(box root + ${landmarks} landmark dir${landmarks === 1 ? "" : "s"}).`
    )
  );
}

/**
 * `--list`: print recent sessions, optionally filtered to a `--since` window.
 * When run from a landmark subdirectory (`cwdContextDir` non-empty), sessions
 * bound to that directory group first — ordering only, nothing is filtered.
 */
export async function runListMode(options: {
  boxRoot: string;
  since: SinceWindow | null;
  /** Box-relative dir the command was run from ("" = box root). */
  cwdContextDir: string;
}): Promise<void> {
  const { boxRoot, since, cwdContextDir } = options;
  const allSessions = await listSessions(boxRoot);
  if (allSessions.length === 0) {
    console.log("No sessions found for this box.");
    await printSearchedRootsFooter(boxRoot);
    return;
  }

  // cwd affinity applies to the non-windowed list only (`--since` stays
  // pure chronology), and it's ordering, never a filter. Partition BEFORE
  // the 20-item cap so a peer older than the top-20 still makes the list.
  const affinity = !since && cwdContextDir !== "";
  const partitioned = affinity
    ? partitionByAffinity(allSessions, cwdContextDir)
    : { peers: [], others: allSessions };
  const grouping = partitioned.peers.length > 0;

  // Pre-filter by mtime when possible: a session whose file mtime is older
  // than the cutoff can't have any activity inside the window.
  const prefiltered = since
    ? allSessions.filter((s) => s.mtime.getTime() >= since.cutoff)
    : [...partitioned.peers, ...partitioned.others].slice(0, 20);

  const enriched = await enrichSessions(prefiltered);

  // A session is in-window if any of its activity is recent enough — i.e. its
  // last event is at or after the cutoff. This catches long-running sessions
  // that started before the window but continued into it.
  const byRecency = since
    ? sessionsInWindow(enriched, { cutoff: since.cutoff, order: "newest-first" })
    : enriched.toSorted((a, b) => {
        const at = a.startTime?.getTime() || 0;
        const bt = b.startTime?.getTime() || 0;
        return bt - at;
      });

  // Re-group the enriched rows (enrichment sorts by start time, which may
  // reshuffle the pre-enrichment mtime order).
  const regrouped = grouping ? partitionByAffinity(byRecency, cwdContextDir) : null;
  const sorted = regrouped ? [...regrouped.peers, ...regrouped.others] : byRecency;

  if (sorted.length === 0) {
    console.log(
      since
        ? `No sessions with activity since ${since.label}.`
        : "No sessions found for this box."
    );
    await printSearchedRootsFooter(boxRoot);
    return;
  }

  console.log(
    since
      ? `Sessions with activity since ${since.label}:\n`
      : "Recent sessions:\n"
  );
  if (grouping) {
    console.log(fmt.dim(`(sessions bound to ${cwdContextDir} or an enclosing dir listed first)`));
    console.log();
  }
  for (const meta of sorted) {
    printListRow(meta);
  }
  console.log();
  await printSearchedRootsFooter(boxRoot);
}

/**
 * A transcript bigger than this refuses to print without `--allow-huge`.
 * Every `cb session` output mode scales with the file (`--raw` is the file,
 * `--tool-report` exceeds it, render is entry-capped but still huge past
 * this), and a surprise multi-hundred-MB dump helps nobody — least of all an
 * agent reading the output. 25 MB is far past any human- or agent-readable
 * result while letting every ordinary session through.
 */
export const HUGE_TRANSCRIPT_BYTES = 25 * 1024 * 1024;

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Fail closed on a huge transcript: true when printing may proceed. When the
 * file exceeds {@link HUGE_TRANSCRIPT_BYTES} and `--allow-huge` wasn't given,
 * prints a loud refusal naming the size and the override and returns false.
 */
export function transcriptPrintable(options: {
  logPath: string;
  sessionId: string;
  allowHuge: boolean;
}): boolean {
  const { logPath, sessionId, allowHuge } = options;
  if (allowHuge) return true;
  const { size } = fs.statSync(logPath);
  if (size <= HUGE_TRANSCRIPT_BYTES) return true;
  console.error(
    `Refusing to print session ${sessionId}: its transcript is ${formatMb(size)} ` +
      `(threshold ${formatMb(HUGE_TRANSCRIPT_BYTES)}). ` +
      "Re-run with --allow-huge if you really want a result this size.",
  );
  return false;
}

/** Print one windowed session in the active output mode (raw/report/render). */
async function renderWindowedSession(options: {
  meta: EnrichedSession;
  since: SinceWindow;
  renderOptions: RenderOptions;
  raw: boolean;
  toolReport: boolean;
  allowHuge: boolean;
}): Promise<void> {
  const { meta, since, renderOptions, raw, toolReport, allowHuge } = options;
  // A refused session is loudly skipped (transcriptPrintable prints why);
  // the other sessions in the window still print.
  if (!transcriptPrintable({ logPath: meta.path, sessionId: meta.sessionId, allowHuge })) {
    return;
  }
  if (raw) {
    // Streamed — a transcript can exceed the heap.
    await pipeline(fs.createReadStream(meta.path), process.stdout, { end: false });
    return;
  }
  if (toolReport) {
    console.log(sessionDivider(meta));
    console.log();
    const report = await generateSessionReport({ logPath: meta.path });
    process.stdout.write(report);
    return;
  }

  // `--since` is a recency filter, so read the recent end of the transcript:
  // a first-page read would drop exactly the entries this mode wants once a
  // session grows past the retention ceiling.
  const { entries, total } = await parseSessionLog({
    logPath: meta.path,
    slice: { mode: "tail", tail: MAX_SESSION_ENTRIES },
  });
  if (entries.length < total) {
    console.warn(
      `Note: session ${meta.sessionId} has ${String(total)} entries; scanning the most recent ${String(entries.length)}.`,
    );
  }
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
  allowHuge: boolean;
}): Promise<void> {
  const { boxRoot, since, renderOptions, raw, toolReport, allowHuge } = options;
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
      allowHuge,
    });
  }
}
