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
function countSteps(parts: ActivityPart[]): number {
  let steps = 0;
  for (const part of parts) {
    if (part.type === "tools") steps += part.tools.filter((tool) => toolCategory(tool) !== "hidden").length;
  }
  return steps;
}

const HEADLINE_CHARS = 90;

/**
 * A note's first line as plain text, for a summary: box markup tags, `*`
 * emphasis and code marks, and a list or heading marker removed; cut at a
 * word with "…" past `HEADLINE_CHARS`. Underscores stay: they are often in
 * names.
 */
export function noteHeadline(text: string): string {
  const line = stripStructuredOutputTags(stripSpeechTags(text)).split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const plain = line.replace(/^(?:#+|[*-]|\d+\.)\s+/, "").replace(/[*`]/g, "");
  if (plain.length <= HEADLINE_CHARS) return plain;
  const cut = plain.slice(0, HEADLINE_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), HEADLINE_CHARS / 2)).trimEnd()}…`;
}

/**
 * The collapsed summary of an activity group. A group with notes shows its
 * newest note's first line and its step count: while a turn runs, each note
 * moves here when the next one arrives. A group with no notes says what kinds
 * of steps it took.
 */
export function summarizeStages(parts: ActivityPart[]): string {
  const newest = parts.findLast((part) => part.type === "note");
  if (newest === undefined) return summarizeActivity(parts);
  const steps = countSteps(parts);
  const headline = noteHeadline(newest.text);
  return steps > 0 ? `${headline} · ${steps} ${steps === 1 ? "step" : "steps"}` : headline;
}

/**
 * The summary line of an opened activity group. With notes, only the step
 * count: the newest note heads its stage just below. Without, the same as
 * folded.
 */
export function summarizeOpenStages(parts: ActivityPart[]): string {
  if (!parts.some((part) => part.type === "note")) return summarizeActivity(parts);
  const steps = countSteps(parts);
  return `${steps} ${steps === 1 ? "step" : "steps"}`;
}
