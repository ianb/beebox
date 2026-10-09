/**
 * Plain-language wording for the chat's activity row. The row describes what
 * the box agent did in terms a non-technical person reads as "the box is
 * working on my stuff", not as commands run on their computer. The raw tool
 * input and result stay one click away in the expanded line.
 */

import type { SessionContentBlock } from "../../../api";
import type { ActivityPart } from "../message-parsing";
import { type KnownToolName, isKnownTool } from "@shared/known-tools";

type Category = "look" | "change" | "step" | "handoff" | "hidden";

/** Tool → summary category, keyed on the shared tool vocabulary. */
const TOOL_CATEGORIES = {
  Read: "look",
  Grep: "look",
  Glob: "look",
  WebSearch: "look",
  WebFetch: "look",
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
  look: { one: "looked something up", many: (n: number) => `looked up ${n} things` },
  change: { one: "made a change", many: (n: number) => `made ${n} changes` },
  step: { one: "took a step", many: (n: number) => `took ${n} steps` },
  handoff: { one: "handed off a task", many: (n: number) => `handed off ${n} tasks` },
} satisfies Record<Exclude<Category, "hidden">, { one: string; many: (n: number) => string }>;

function toolCategory(name: string): Category {
  // MCP tools and future built-ins count as steps.
  return isKnownTool(name) ? TOOL_CATEGORIES[name] : "step";
}

/** Summarize an activity group (thinking + tools) for the collapsed header. */
export function summarizeActivity(parts: ActivityPart[]): string {
  let hasThinking = false;
  const counts = new Map<Exclude<Category, "hidden">, number>();
  for (const part of parts) {
    switch (part.type) {
      case "thinking":
        hasThinking = true;
        break;
      case "tools":
        for (const tool of part.tools) {
          const category = toolCategory(tool.toolName || "");
          if (category === "hidden") continue;
          counts.set(category, (counts.get(category) || 0) + 1);
        }
        break;
    }
  }

  const segments: string[] = [];
  if (hasThinking) segments.push("thought it over");
  for (const [category, count] of counts) {
    const phrase = CATEGORY_PHRASES[category];
    segments.push(count === 1 ? phrase.one : phrase.many(count));
  }
  return segments.join(", ") || "working";
}

function cardTitle(path: string): string | null {
  const base = path.split("/").pop() || "";
  if (!base.endsWith(".card")) return null;
  const withoutCard = base.slice(0, -".card".length);
  const dot = withoutCard.lastIndexOf(".");
  const name = dot > 0 ? withoutCard.slice(0, dot) : withoutCard;
  return name.replace(/_/g, " ");
}

const SCHEMA_PATH = /(?:^|\/)schemas\/([^/]+)\.ts$/;

function schemaName(path: string): string | null {
  const match = SCHEMA_PATH.exec(path);
  return match?.[1] ? match[1].replace(/[_-]/g, " ") : null;
}

function describeFileTool(
  { verbs, path }: { verbs: { card: string; schema: (name: string) => string; other: string }; path: string },
): string {
  const title = cardTitle(path);
  if (title) return `${verbs.card} ${title}`;
  const schema = schemaName(path);
  if (schema) return verbs.schema(schema);
  return verbs.other;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function filePath(input: Record<string, unknown>): string {
  return typeof input.file_path === "string" ? input.file_path : "";
}

function stringInput(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value.trim() : "";
}

type ToolDescriber = (input: Record<string, unknown>) => string;

// `Map`, not `Record`: most tool names (MCP, future built-ins) genuinely
// aren't in this table, and `Map.get()` is honestly `V | undefined`.
const toolDescribers = new Map<string, ToolDescriber>(Object.entries({
  Read: (input) => describeFileTool({
    path: filePath(input),
    verbs: { card: "Looked at", schema: () => "Looked something up", other: "Looked something up" },
  }),
  Edit: (input) => describeFileTool({
    path: filePath(input),
    verbs: { card: "Updated", schema: (n) => `Changed how ${n} cards work`, other: "Made a change" },
  }),
  Write: (input) => describeFileTool({
    path: filePath(input),
    verbs: { card: "Saved", schema: (n) => `Set up ${n} cards`, other: "Made a change" },
  }),
  Bash: (input) => {
    const description = stringInput(input, "description");
    return description ? capitalize(description) : "Took a step";
  },
  Grep: () => "Searched the box",
  Glob: () => "Looked through the box",
  WebSearch: (input) => {
    const query = stringInput(input, "query");
    return query ? `Searched the web for "${query}"` : "Searched the web";
  },
  WebFetch: (input) => {
    const url = stringInput(input, "url");
    return URL.canParse(url) ? `Read a page on ${new URL(url).hostname}` : "Read a web page";
  },
  TodoWrite: () => "Updated the plan",
  Agent: (input) => stringInput(input, "description") || "Handed off a task",
  Task: (input) => stringInput(input, "description") || "Handed off a task",
} satisfies Record<string, ToolDescriber>));

/** Plain-language one-line description of a single tool call. */
export function describeToolCall(block: SessionContentBlock): string {
  const describer = toolDescribers.get(block.toolName || "");
  if (describer) return describer(block.input || {});
  return block.inputSummary || block.toolName || "Tool call";
}
