/**
 * The collapsed summary of the chat's activity row: what kinds of steps a
 * group took, in plain words, and how its notes (the lines the agent wrote
 * between steps) divide it into parts. `activity-wording.ts` words each step.
 */

import type { SessionContentBlock } from "../../../api";
import type { ActivityPart } from "../assistant-parts";
import { type KnownToolName, isKnownTool } from "@shared/known-tools";
import { stripStructuredOutputTags } from "../../../lib/structured-output-parsing";
import { stripSpeechTags } from "../message-parsing";
import { commandLookups } from "./activity-wording";

type Category = "look" | "search" | "webpage" | "change" | "step" | "handoff" | "hidden";

/** Tool → summary category, keyed on the shared tool vocabulary. */
const TOOL_CATEGORIES = {
  Read: "look",
  Grep: "look",
  Glob: "look",
  // The web is named as the web: "looked up" alone did not say whether the
  // agent searched the person's box or the internet.
  WebSearch: "search",
  WebFetch: "webpage",
  Edit: "change",
  Write: "change",
  Bash: "step",
  Agent: "handoff",
  Task: "handoff",
  // Agent machinery: not counted.
  TodoWrite: "hidden",
} satisfies Record<KnownToolName, Category>;

/** Collapsed-summary phrase for a category: one occurrence, or n of them. */
const CATEGORY_PHRASES = {
  look: { one: "checked something in your box", many: (n: number) => `checked ${n} things in your box` },
  search: { one: "searched the web", many: (n: number) => `searched the web ${n} times` },
  webpage: { one: "read a web page", many: (n: number) => `read ${n} web pages` },
  change: { one: "made a change", many: (n: number) => `made ${n} changes` },
  step: { one: "took a step", many: (n: number) => `took ${n} steps` },
  handoff: { one: "handed off a task", many: (n: number) => `handed off ${n} tasks` },
} satisfies Record<Exclude<Category, "hidden">, { one: string; many: (n: number) => string }>;

function toolCategory(tool: SessionContentBlock): Category {
  const name = tool.toolName || "";
  // A Codex command Codex parsed as reads, searches, or listings is a look.
  if (name === "Bash" && commandLookups(tool.input || {}) !== null) return "look";
  // MCP tools and future built-ins count as steps.
  return isKnownTool(name) ? TOOL_CATEGORIES[name] : "step";
}

/** Summarize an activity group (thinking, tools, notes) for the collapsed header. */
export function summarizeActivity(parts: ActivityPart[]): string {
  let hasThinking = false;
  let hasNote = false;
  const counts = new Map<Exclude<Category, "hidden">, number>();
  for (const part of parts) {
    switch (part.type) {
      case "thinking":
        hasThinking = true;
        break;
      case "tools":
        for (const tool of part.tools) {
          const category = toolCategory(tool);
          if (category === "hidden") continue;
          counts.set(category, (counts.get(category) || 0) + 1);
        }
        break;
      case "note":
        hasNote = true;
        break;
    }
  }

  const segments: string[] = [];
  if (hasThinking) segments.push("thought it over");
  for (const [category, count] of counts) {
    const phrase = CATEGORY_PHRASES[category];
    segments.push(count === 1 ? phrase.one : phrase.many(count));
  }
  // Notes are not counted as steps; they name a group only when it has nothing else.
  return segments.join(", ") || (hasNote ? "noted progress" : "working");
}

/** Steps the summary counts: tool calls, less hidden machinery (TodoWrite). Thinking and notes are not steps. */
export function countSteps(parts: ActivityPart[]): number {
  let steps = 0;
  for (const part of parts) {
    if (part.type === "tools") steps += part.tools.filter((tool) => toolCategory(tool) !== "hidden").length;
  }
  return steps;
}

const HEADLINE_CHARS = 90;

/**
 * A note's first line as plain text, for a summary: box markup tags, markdown
 * emphasis and code marks, and a list or heading marker removed; cut at a
 * word with "…" past `HEADLINE_CHARS`.
 */
export function noteHeadline(text: string): string {
  const line = stripStructuredOutputTags(stripSpeechTags(text)).split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const plain = line.replace(/^(?:#+|[*-]|\d+\.)\s+/, "").replace(/[*_`]/g, "");
  if (plain.length <= HEADLINE_CHARS) return plain;
  const cut = plain.slice(0, HEADLINE_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), HEADLINE_CHARS / 2)).trimEnd()}…`;
}

const counted = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The collapsed summary of an activity group that has notes, in one of the
 * forms on offer: the stage count, the newest note, or today's summary with
 * a note count. A group with no notes keeps today's summary.
 */
export function summarizeStages(parts: ActivityPart[], form: "count" | "note" | "today"): string {
  const notes = parts.flatMap((part) => (part.type === "note" ? [part.text] : []));
  const base = summarizeActivity(parts);
  const newest = notes.at(-1);
  if (newest === undefined) return base;
  const steps = countSteps(parts);
  switch (form) {
    case "count":
      return `${counted(notes.length, "part")} · ${counted(steps, "step")}`;
    case "note":
      return steps > 0 ? `${noteHeadline(newest)} · ${counted(steps, "step")}` : noteHeadline(newest);
    case "today":
      return `${base} · ${counted(notes.length, "note")}`;
  }
}
