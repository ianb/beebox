/**
 * Plain-language wording for the chat's activity row. The row describes what
 * the box agent did in terms a non-technical person reads as "the box is
 * working on my stuff", not as commands run on their computer. The raw tool
 * input and result stay one click away in the expanded line.
 */

import type { SessionContentBlock } from "../../../api";
import type { ActivityPart } from "../assistant-parts";
import { type KnownToolName, isKnownTool } from "@shared/known-tools";
import { attachDirOwnerBasename } from "@shared/attach-path";
import { cardDisplayName } from "@shared/card-name";

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

function toolCategory(name: string): Category {
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
          const category = toolCategory(tool.toolName || "");
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

const SCHEMA_PATH = /(?:^|\/)schemas\/([^/]+)\.ts$/;

function schemaName(path: string): string | null {
  const match = SCHEMA_PATH.exec(path);
  return match?.[1] ? match[1].replace(/[_-]/g, " ") : null;
}

/** English plural for a card type's name, good enough for a status line. */
function plural(name: string): string {
  if (/[^aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/.test(name)) return `${name}es`;
  return `${name}s`;
}

/**
 * The part of a path inside the person's content folder, or null for agent
 * machinery (`_config/`, `.git/`) and paths with no `_content/` segment.
 * Paths arrive absolute or box-relative, so the last segment named
 * `_content` wins.
 */
function contentRelative(path: string): string | null {
  const parts = path.split("/");
  const at = parts.lastIndexOf("_content");
  if (at === -1) return null;
  const rest = parts.slice(at + 1).filter(Boolean);
  return rest.length === 0 ? null : rest.join("/");
}

/** A document's name: the basename without its last extension, `_` → space. */
function documentName(base: string): string {
  const dot = base.lastIndexOf(".");
  const name = dot > 0 ? base.slice(0, dot) : base;
  return name.replace(/_/g, " ");
}

/** The thing a file is to the person: a card title, or a content document's name. */
function thingName(path: string): string | null {
  const title = cardDisplayName(path);
  if (title) return title;
  const relative = contentRelative(path);
  if (!relative) return null;
  return documentName(relative.split("/").pop() || "");
}

/**
 * Where a content file sits, in words: "in recipes", or "in Lemon Chicken"
 * for a file in that card's `.attach/` folder. Null at the top of the
 * content folder and outside it.
 */
function placeName(path: string): string | null {
  const relative = contentRelative(path);
  if (!relative) return null;
  const folders = relative.split("/").slice(0, -1);
  const folder = folders.at(-1);
  if (!folder) return null;
  const owner = attachDirOwnerBasename(folder);
  if (owner !== null) return `in ${owner.replace(/_/g, " ")}`;
  return `in ${folder.replace(/_/g, " ")}`;
}

interface FileVerbs {
  card: string;
  document: string;
  schema: (name: string) => string;
  other: string;
}

function describeFileTool({ verbs, input }: { verbs: FileVerbs; input: Record<string, unknown> }): string {
  const path = filePath(input);
  const title = cardDisplayName(path);
  const more = extraPathCount(input);
  const suffix = more > 0 ? ` and ${more} more` : "";
  if (title) return `${verbs.card} ${title}${suffix}`;
  const schema = schemaName(path);
  if (schema) return verbs.schema(schema);
  const name = thingName(path);
  if (name) return `${verbs.document} ${name}${suffix}`;
  return verbs.other;
}

/** Codex reports one file change touching several files as `file_paths`. */
function extraPathCount(input: Record<string, unknown>): number {
  const paths = input.file_paths;
  return Array.isArray(paths) && paths.length > 1 ? paths.length - 1 : 0;
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

type SearchTool = "Grep" | "Glob";

/**
 * What a search looked for, as the line says it: `"lease"` for plain words,
 * `recipe cards` for a Glob of `**\/*.recipe.card`. A Glob's `**\/` and
 * outer `*` are trimmed, and `.` is literal there; in a Grep regex `.` is a
 * wildcard, so it is not a plain word. Null for any other pattern, which the
 * expanded line shows under it instead.
 */
function searchSubject(tool: SearchTool, pattern: string): string | null {
  if (tool === "Grep") return /^[\p{L}\p{N}][\p{L}\p{N} '’-]*$/u.test(pattern) ? `"${pattern}"` : null;
  const cardType = /^(?:\*\*\/)?\*\.([\w-]+)\.card$/.exec(pattern);
  if (cardType?.[1]) return `${cardType[1].replace(/[_-]/g, " ")} cards`;
  const words = pattern.replace(/^\*\*\//, "").replace(/^\*+|\*+$/g, "").trim();
  return /^[\p{L}\p{N}][\p{L}\p{N} '’.-]*$/u.test(words) ? `"${words}"` : null;
}

const SEARCH_VERBS = { Grep: "Searched your box", Glob: "Looked through your box" } satisfies Record<SearchTool, string>;

function describeSearch(tool: SearchTool, input: Record<string, unknown>): string {
  const subject = searchSubject(tool, stringInput(input, "pattern"));
  return subject ? `${SEARCH_VERBS[tool]} for ${subject}` : SEARCH_VERBS[tool];
}

type ToolDescriber = (input: Record<string, unknown>) => string;

// `Map`, not `Record`: most tool names (MCP, future built-ins) genuinely
// aren't in this table, and `Map.get()` is honestly `V | undefined`.
const toolDescribers = new Map<string, ToolDescriber>(Object.entries({
  Read: (input) => describeFileTool({
    input,
    verbs: { card: "Looked at", document: "Looked at", schema: () => "Checked something in your box", other: "Checked something in your box" },
  }),
  Edit: (input) => describeFileTool({
    input,
    verbs: { card: "Updated", document: "Made a change to", schema: (n) => `Changed how your ${plural(n)} are kept`, other: "Made a change" },
  }),
  Write: (input) => describeFileTool({
    input,
    verbs: { card: "Saved", document: "Saved", schema: (n) => `Set up a place for your ${plural(n)}`, other: "Made a change" },
  }),
  Bash: (input) => {
    const description = stringInput(input, "description");
    return description ? capitalize(description) : "Took a step";
  },
  Grep: (input) => describeSearch("Grep", input),
  Glob: (input) => describeSearch("Glob", input),
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
  // An unknown tool's name and input summary (raw JSON for MCP tools) are
  // plumbing; both stay in the expanded detail.
  return "Took a step";
}

/** The plain detail an expanded line shows under its sentence: what an edit replaced, or a search pattern. */
export type Excerpt =
  | { kind: "change"; before: string; after: string; everywhere: boolean }
  | { kind: "text"; label: string; text: string };

/** The detail an expanded activity line adds to its sentence. */
export interface ToolCallDetail {
  /** "in recipes"; null outside the content folder or at its top. */
  place: string | null;
  /** The step's result was an error: the change the input asked for did not happen. */
  failed: boolean;
  /** Null when the input has nothing plain to show, the step failed, or an edit has no result yet. */
  excerpt: Excerpt | null;
  /**
   * The content file a finished edit changed, for the line to link: its
   * box-relative path, and the name the sentence calls it. A Codex change
   * across several files links the first. Null for reads, failures, and
   * files outside the content folder.
   */
  opens: { path: string; name: string } | null;
}

function openTarget(path: string): { path: string; name: string } | null {
  const relative = contentRelative(path);
  const name = thingName(path);
  return relative && name ? { path: `_content/${relative}`, name } : null;
}

const EXCERPT_LINES = 3;
const EXCERPT_CHARS = 200;

/** Cut agent text to a few short lines, marking the cut with "…". */
function shorten(text: string): string {
  const lines = text.split("\n");
  let cut = lines.slice(0, EXCERPT_LINES).join("\n");
  if (cut.length > EXCERPT_CHARS) cut = cut.slice(0, EXCERPT_CHARS);
  return cut.length < text.length ? `${cut.trimEnd()}…` : cut;
}

/** Drop blank lines and trailing space at the ends; indentation is kept, since it can be the change. */
function trimBlankLines(text: string): string {
  return text.replace(/^(?:[\t ]*\r?\n)+/, "").trimEnd();
}

/** A string input; null when absent, so an emptied side still reads as a change. */
function presentString(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" ? value : null;
}

/**
 * Drop the lines an edit kept at its start and end, so an added line reads
 * as an addition and not as the old text struck out and repeated.
 */
function changedLines(before: string, after: string): [string, string] {
  const old = before.split("\n");
  const now = after.split("\n");
  let start = 0;
  while (start < old.length && start < now.length && old[start] === now[start]) start++;
  let end = 0;
  while (end < old.length - start && end < now.length - start && old[old.length - 1 - end] === now[now.length - 1 - end]) end++;
  return [trimBlankLines(old.slice(start, old.length - end).join("\n")), trimBlankLines(now.slice(start, now.length - end).join("\n"))];
}

type ExcerptDescriber = (input: Record<string, unknown>, done: boolean) => Excerpt | null;

// Edit only: Codex file changes carry paths, not text
// (`services/codex-tool-activity.ts`), so they get a name and no excerpt.
const excerptDescribers = new Map<string, ExcerptDescriber>(Object.entries({
  // Before a result arrives (still running, or interrupted) the text is only
  // what the agent asked for, so it is not shown as a change.
  Edit: (input, done) => {
    if (!done) return null;
    const oldText = presentString(input, "old_string");
    const newText = presentString(input, "new_string");
    if (oldText === null || newText === null) return null;
    const [before, after] = changedLines(oldText, newText);
    if (before === "" && after === "") return null;
    return { kind: "change", before: shorten(before), after: shorten(after), everywhere: input.replace_all === true };
  },
  Grep: (input) => searchExcerpt("Grep", input),
  Glob: (input) => searchExcerpt("Glob", input),
} satisfies Record<string, ExcerptDescriber>));

/** A pattern that is not plain words stays off the line; the expanded line shows it. */
function searchExcerpt(tool: SearchTool, input: Record<string, unknown>): Excerpt | null {
  const pattern = stringInput(input, "pattern");
  if (!pattern || searchSubject(tool, pattern)) return null;
  return { kind: "text", label: "Looked for", text: shorten(pattern) };
}

/** Claude Code marks a refused or failed tool call's result with this tag. */
const TOOL_ERROR_PREFIX = "<tool_use_error>";

/** The place, failure, and excerpt an expanded line shows with `describeToolCall`'s sentence. */
export function describeToolDetail(block: SessionContentBlock): ToolCallDetail {
  const input = block.input || {};
  const name = block.toolName || "";
  const isFileTool = name === "Read" || name === "Edit" || name === "Write";
  const failed = (block.resultSummary || "").trimStart().startsWith(TOOL_ERROR_PREFIX);
  const done = block.resultSummary !== undefined && !failed;
  return {
    place: isFileTool ? placeName(filePath(input)) : null,
    failed,
    excerpt: failed ? null : excerptDescribers.get(name)?.(input, done) ?? null,
    // A Codex file change carries no result; its own status says it finished.
    opens: (done || (!failed && input.status === "completed")) && (name === "Edit" || name === "Write") ? openTarget(filePath(input)) : null,
  };
}
