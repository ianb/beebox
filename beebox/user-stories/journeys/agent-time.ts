/**
 * Claude root-chat time from a user entry to first assistant text.
 *
 * This is a partial latency metric: scoped chats use another transcript directory,
 * other engines are unsupported, and the first text may precede the final answer.
 * collect.ts records its provenance; clock.ts exposes the same limits to a walker.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { isRecord } from "../../src/lib/is-record.ts";
import { parseJsonLine } from "../pipeline/json-io.ts";

export interface AgentTiming {
  /** One entry per observed first-text interval, in seconds. */
  turns: number[]
  totalSeconds: number
  medianSeconds: number
  slowestSeconds: number
}

interface Entry { timestamp?: string, type?: string, message?: { content?: unknown } }

/**
 * Claude Code keys its transcript directories by the working directory, with every
 * separator replaced by a dash — so a box's chats are found from the box's own path
 * and nothing has to be threaded through the run.
 */
function transcriptDir(boxContent: string): string {
  return join(homedir(), ".claude", "projects", boxContent.replaceAll("/", "-"));
}

export function agentTiming(boxContent: string): AgentTiming {
  const dir = transcriptDir(boxContent);
  const turns: number[] = [];

  if (existsSync(dir)) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
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

        if (entry.type === "user" && !kinds.includes("tool_result")) openedAt = at;
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
    medianSeconds: sorted.length === 0 ? 0 : (sorted[Math.floor(sorted.length / 2)] ?? 0),
    slowestSeconds: sorted.length === 0 ? 0 : (sorted.at(-1) ?? 0),
  };
}
