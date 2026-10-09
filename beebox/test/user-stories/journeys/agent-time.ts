/**
 * Claude chat time from a user entry to first assistant text, over a box's root
 * chat and its place chats.
 *
 * This is a partial latency metric: other engines are unsupported, and the first
 * text may precede the final answer. collect.ts records its provenance; clock.ts
 * exposes the same limits to a walker.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { isRecord } from "../../../src/shared/is-record.ts";
import { parseJsonLine } from "../../../src/scripts/user-stories/json-io.ts";

export interface AgentTiming {
  /** One entry per observed first-text interval, in seconds. */
  turns: number[]
  totalSeconds: number
  medianSeconds: number
  slowestSeconds: number
}

interface Entry { timestamp?: string, type?: string, isMeta?: boolean, message?: { content?: unknown } }

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

export function agentTiming(boxRoot: string): AgentTiming {
  const turns: number[] = [];
  const agentRuns = agentRunSessions(boxRoot);

  for (const dir of transcriptDirs(boxRoot)) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
      if (agentRuns.has(file.slice(0, -".jsonl".length))) continue;
      // A turn opens on a user entry that is not tool plumbing, and closes on the
      // first assistant entry carrying text. Tool-call entries in between are part of
      // the same wait, which is the point — the person is still looking at a spinner.
      let openedAt: number | null = null;
      for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
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
        if (entry.type === "user" && entry.isMeta !== true && !kinds.includes("tool_result")) openedAt = at;
        else if (entry.type === "assistant" && openedAt !== null && kinds.includes("text")) {
          turns.push((at - openedAt) / 1000);
          openedAt = null;
        }
      }
    }
  }

  const sorted = turns.toSorted((a, b) => a - b);
  return {
    turns,
    totalSeconds: turns.reduce((n, t) => n + t, 0),
    medianSeconds: median(sorted),
    slowestSeconds: sorted.length === 0 ? 0 : (sorted.at(-1) ?? 0),
  };
}
