/**
 * Claude chat turn timing over a box's root chat and its place chats.
 *
 * The transcript gives each turn's text entries; the hub log (`.beebox/hub-child.log`)
 * gives the send and completion times. Joined, a turn reports time from the hub's
 * send to the first answer text and to "Turn complete", and marks a progress line
 * as interim. Other engines are unsupported. collect.ts records the provenance;
 * clock.ts exposes the same limits to a walker.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { isRecord } from "../../../src/shared/is-record.ts";
import { parseJsonLine } from "../../../src/scripts/user-stories/json-io.ts";

/** One Claude chat turn, with the hub's own clock where the hub log has it. */
export interface TurnDetail {
  /** When the transcript's user message landed (ms since epoch). */
  openedAt: number
  /** The hub's "Sending message" time when one matches this turn, else `openedAt`. */
  startedAt: number
  startSource: "hub" | "transcript"
  /** Seconds the transcript's user message trailed the hub's send; 0 without a hub match. */
  sendLagSeconds: number
  /** Seconds from `startedAt` to the first assistant text, or null when none arrived. */
  firstTextSeconds: number | null
  /** The first text was followed by more work, so it is a progress line and not the answer. */
  firstTextInterim: boolean
  /** Seconds from `startedAt` to the first text that was not interim, or null. */
  answerSeconds: number | null
  /** Seconds from `startedAt` to the hub's "Turn complete", or null when the hub log has none. */
  completeSeconds: number | null
}

export interface AgentTiming {
  /**
   * One entry per observed first-text interval, in seconds, ordered by the time
   * the turn opened. Transcripts are read directory by directory, so a root-chat
   * turn and a later place-chat turn arrive out of order; `turns.at(-1)` is the
   * latest turn only after this sort. Measured from the transcript's user message
   * and counting an interim line as first text; `detail` has the corrected view.
   */
  turns: number[]
  totalSeconds: number
  medianSeconds: number
  slowestSeconds: number
  /** Turns with no assistant text after them: a reply on its way, or an abandoned turn. */
  waiting: number
  /** Every turn, ordered by `openedAt`, including those with no text yet. */
  detail: TurnDetail[]
}

/** A hub "Sending message" line and the "Turn complete" that closed it (null while running). */
export interface HubTurn { sendAt: number, completeAt: number | null }

/** A transcript turn before it is joined to the hub log. */
export interface RawTurn {
  openedAt: number
  texts: { at: number, interim: boolean }[]
}

interface Entry {
  timestamp?: string
  type?: string
  isMeta?: boolean
  message?: { content?: unknown }
  attachment?: { type?: string }
}

/**
 * Claude Code keys its transcript directories by the working directory, with every
 * character other than a letter or digit replaced by a dash. A root chat runs at
 * the box root; a place chat runs in the place's folder, so its directory is the
 * root's name plus `--content-<place>` (`/_content/` becomes `--content-`). The
 * double dash keeps a box named `walk` from matching a box named `walk-2`.
 */
function transcriptDirs(boxRoot: string): string[] {
  const projects = join(homedir(), ".claude", "projects");
  const root = boxRoot.replaceAll(/[^\dA-Za-z]/g, "-");
  if (!existsSync(projects)) return [];
  return readdirSync(projects)
    .filter((name) => name === root || name.startsWith(`${root}--`))
    .map((name) => join(projects, name));
}

/**
 * Sessions the box's usage manifest names. Every engine agent run (the chat-title
 * and chat-review passes, procedures, triage) records itself there; a live chat
 * does not. The title run shares the root chat's transcript directory, so without
 * this each title counted as a chat turn.
 */
function agentRunSessions(boxRoot: string): Set<string> {
  const manifest = join(boxRoot, "_bookkeeping", "usage", "session-manifest.jsonl");
  const ids = new Set<string>();
  if (!existsSync(manifest)) return ids;
  for (const line of readFileSync(manifest, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const entry = parseJsonLine<{ sessionId?: unknown }>(line);
    if (typeof entry.sessionId === "string") ids.add(entry.sessionId);
  }
  return ids;
}

/** Median of ascending values; an even count averages the middle two. */
function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? 0) + upper) / 2;
}

/**
 * The turns of one transcript file. A turn opens on a user entry that is not tool
 * plumbing and lasts until the next one. A text entry is interim when the turn went
 * on to call a tool after it, or when it followed Claude Code's silent-turn
 * reminder ("say in a few words what you're doing") and more text came later: both
 * are progress lines, not the answer.
 */
export function parseTranscriptTurns(text: string): RawTurn[] {
  interface OpenText { at: number, afterReminder: boolean, followedByTool: boolean }
  const turns: RawTurn[] = [];
  let current: { openedAt: number, texts: OpenText[], reminder: boolean } | null = null;
  const close = (): void => {
    if (current === null) return;
    const texts = current.texts;
    turns.push({
      openedAt: current.openedAt,
      texts: texts.map((t, i) => ({ at: t.at, interim: t.followedByTool || (t.afterReminder && i < texts.length - 1) })),
    });
    current = null;
  };

  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let entry: Entry;
    try {
      entry = parseJsonLine<Entry>(line);
    } catch (_e) {
      continue; // a partially-written line during a live run is normal
    }
    if (entry.timestamp === undefined) continue;
    const at = new Date(entry.timestamp).getTime();
    const content = entry.message?.content;
    const kinds = Array.isArray(content)
      ? content.map((b) => (isRecord(b) ? String(b["type"]) : ""))
      : [];

    // A skill expansion arrives as a meta user entry after the person's message;
    // treating it as a new turn would restart the clock partway through the wait.
    if (entry.type === "user" && entry.isMeta !== true && !kinds.includes("tool_result")) {
      close();
      current = { openedAt: at, texts: [], reminder: false };
    } else if (current !== null && entry.type === "attachment" && entry.attachment?.type === "silent_turn_reminder") {
      current.reminder = true;
    } else if (current !== null && entry.type === "assistant") {
      if (kinds.includes("text")) current.texts.push({ at, afterReminder: current.reminder, followedByTool: false });
      if (kinds.includes("tool_use")) for (const t of current.texts) t.followedByTool = true;
    }
  }
  close();
  return turns;
}

/**
 * Sends and completions from a hub log. The log names no session, so a "Turn
 * complete" closes the oldest send still open; overlapping turns in different
 * chats can swap their completions, which a walk (one person, one chat at a time)
 * does not produce.
 */
export function parseHubTurns(log: string): HubTurn[] {
  const turns: HubTurn[] = [];
  const open: HubTurn[] = [];
  for (const line of log.split("\n")) {
    const m = /^(\S+) \[std(?:out|err)\] \[ChatSession:(send|done)\] (Sending message|Turn complete)/u.exec(line);
    if (m === null) continue;
    const at = new Date(m[1] ?? "").getTime();
    if (Number.isNaN(at)) continue;
    if (m[2] === "send") {
      const turn: HubTurn = { sendAt: at, completeAt: null };
      turns.push(turn);
      open.push(turn);
    } else {
      const turn = open.shift();
      if (turn !== undefined) turn.completeAt = at;
    }
  }
  return turns;
}

/** How far before the transcript's user message the hub's send may sit and still be the same turn. */
const SEND_LAG_WINDOW_MS = 60_000;

/**
 * Join transcript turns to hub sends: each turn takes the latest unused send at or
 * before its user message (within a minute), which is the send that produced it.
 */
export function joinTurns(raw: RawTurn[], hub: HubTurn[]): TurnDetail[] {
  const used = new Set<HubTurn>();
  return raw.toSorted((a, b) => a.openedAt - b.openedAt).map((turn) => {
    const send = hub
      .filter((h) => !used.has(h) && h.sendAt <= turn.openedAt + 1000 && turn.openedAt - h.sendAt <= SEND_LAG_WINDOW_MS)
      .toSorted((a, b) => b.sendAt - a.sendAt)[0];
    if (send !== undefined) used.add(send);
    const startedAt = send?.sendAt ?? turn.openedAt;
    const seconds = (at: number): number => (at - startedAt) / 1000;
    const first = turn.texts[0];
    const answer = turn.texts.find((t) => !t.interim);
    return {
      openedAt: turn.openedAt,
      startedAt,
      startSource: send === undefined ? "transcript" : "hub",
      sendLagSeconds: send === undefined ? 0 : Math.max(0, (turn.openedAt - send.sendAt) / 1000),
      firstTextSeconds: first === undefined ? null : seconds(first.at),
      firstTextInterim: first?.interim ?? false,
      answerSeconds: answer === undefined ? null : seconds(answer.at),
      completeSeconds: send?.completeAt == null ? null : seconds(send.completeAt),
    };
  });
}

export function agentTiming(boxRoot: string): AgentTiming {
  const raw: RawTurn[] = [];
  const agentRuns = agentRunSessions(boxRoot);

  for (const dir of transcriptDirs(boxRoot)) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
      if (agentRuns.has(file.slice(0, -".jsonl".length))) continue;
      raw.push(...parseTranscriptTurns(readFileSync(join(dir, file), "utf8")));
    }
  }

  const hubLog = join(boxRoot, ".beebox", "hub-child.log");
  const hub = existsSync(hubLog) ? parseHubTurns(readFileSync(hubLog, "utf8")) : [];
  const detail = joinTurns(raw, hub);

  // The long-standing figure: transcript user message to first assistant text.
  const ordered = raw.toSorted((a, b) => a.openedAt - b.openedAt);
  const turns = ordered.flatMap((t) => (t.texts[0] === undefined ? [] : [(t.texts[0].at - t.openedAt) / 1000]));
  const sorted = turns.toSorted((a, b) => a - b);
  return {
    turns,
    totalSeconds: turns.reduce((n, t) => n + t, 0),
    medianSeconds: median(sorted),
    slowestSeconds: sorted.length === 0 ? 0 : (sorted.at(-1) ?? 0),
    waiting: raw.filter((t) => t.texts.length === 0).length,
    detail,
  };
}
