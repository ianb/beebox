/**
 * Rendering of assistant "activity" — tool calls and thinking blocks —
 * including the collapsed summaries used in the chat transcript.
 */

import { Pre } from "../ui/Pre";
import { JsonView } from "../ui/JsonView";
import type { SessionContentBlock } from "../../api";
import type { ActivityPart } from "./message-parsing";
import { type KnownToolName, isKnownTool } from "@shared/known-tools";

/**
 * Human-readable description of a single tool call.
 */
type ToolDescriber = (input: Record<string, unknown>, block: SessionContentBlock) => string;

// `Map`, not `Record`: `Map.get()` is honestly typed `V | undefined` for an
// unknown key, whereas a `Record` index read types as always-defined without
// `noUncheckedIndexedAccess` (which the frontend tsconfig lacks) even though
// most tool names genuinely aren't in this table.
const toolDescribers = new Map<string, ToolDescriber>(Object.entries({
  Read: (input) => {
    const p = String(input.file_path || "");
    return p ? `Read ${shortPath(p)}` : "Read a file";
  },
  Edit: (input) => {
    const p = String(input.file_path || "");
    return p ? `Edited ${shortPath(p)}` : "Edited a file";
  },
  Write: (input) => {
    const p = String(input.file_path || "");
    return p ? `Wrote ${shortPath(p)}` : "Wrote a file";
  },
  Bash: (input) => {
    if (input.description) return `Ran script: ${String(input.description)}`;
    const cmd = String(input.command || "");
    const first = cmd.split("\n")[0];
    if (!first) return "Ran a command";
    return `Ran script: ${first.length > 60 ? `${first.substring(0, 57)}...` : first}`;
  },
  Grep: (input) => `Searched for "${input.pattern || ""}"`,
  Glob: (input) => `Found files matching ${input.pattern || "..."}`,
  TodoWrite: () => "Updated task list",
  Agent: (input) => String(input.description || "Delegated a task"),
  Task: (input) => String(input.description || "Delegated a task"),
} satisfies Record<string, ToolDescriber>));

/** Tools that are boring enough to not need an expandable details view */
const nonExpandableTools = new Set(["Read", "Glob"]);

function describeToolCall(block: SessionContentBlock): string {
  const input = block.input || {};
  const describer = toolDescribers.get(block.toolName || "");
  if (describer) return describer(input, block);
  return block.inputSummary || block.toolName || "Tool call";
}

function shortPath(p: string): string {
  const parts = p.split("/");
  if (parts.length <= 2) return p;
  return parts.slice(-2).join("/");
}

type ActivityParts = ActivityPart[];

/**
 * Summarize an activity group (thinking + tools) for the collapsed header.
 */
function summarizeActivity(parts: ActivityParts): string {
  const segments: string[] = [];
  let hasThinking = false;

  const counts: Record<string, number> = {};
  for (const part of parts) {
    switch (part.type) {
      case "thinking":
        hasThinking = true;
        break;
      case "tools":
        for (const tool of part.tools) {
          const category = toolCategory(tool.toolName || "");
          counts[category] = (counts[category] || 0) + 1;
        }
        break;
    }
  }

  if (hasThinking) segments.push("thinking");

  for (const [category, count] of Object.entries(counts)) {
    if (count === 1) {
      segments.push(categorySingular(category));
    } else {
      segments.push(`${categoryVerb(category)} ${count} ${categoryPlural(category)}`);
    }
  }

  return segments.join(", ") || "working";
}

/** Tool → display category, keyed on the shared tool vocabulary. */
const TOOL_CATEGORIES = {
  Read: "read",
  Edit: "edit",
  Write: "edit",
  Bash: "command",
  Grep: "search",
  Glob: "search",
  Agent: "task",
  Task: "task",
  TodoWrite: "todo",
} satisfies Record<KnownToolName, string>;

function toolCategory(name: string): string {
  return isKnownTool(name) ? TOOL_CATEGORIES[name] : "tool";
}

function categorySingular(cat: string): string {
  switch (cat) {
    case "read": return "read a file";
    case "edit": return "edited a file";
    case "command": return "ran a command";
    case "search": return "searched documents";
    case "task": return "delegated a task";
    case "todo": return "updated tasks";
    default: return "used a tool";
  }
}

function categoryVerb(cat: string): string {
  switch (cat) {
    case "read": return "read";
    case "edit": return "edited";
    case "command": return "ran";
    case "search": return "searched";
    case "task": return "delegated";
    default: return "used";
  }
}

function categoryPlural(cat: string): string {
  switch (cat) {
    case "read": return "files";
    case "edit": return "files";
    case "command": return "commands";
    case "search": return "searches";
    case "task": return "tasks";
    default: return "tools";
  }
}

/**
 * Render a single tool call — expandable for interesting tools, plain text for boring ones.
 */
function ToolDetail({ block }: { block: SessionContentBlock }) {
  const input = block.input;
  const result = block.resultSummary;
  const description = describeToolCall(block);

  if (nonExpandableTools.has(block.toolName || "")) {
    return <div className="py-0.5">{description}</div>;
  }

  return (
    <details className="group/tool">
      <summary className="cursor-pointer list-none flex items-center gap-1 hover:text-warm-700 py-0.5">
        <span className="text-warm-500 group-open/tool:rotate-90 transition-transform text-[10px]">&#9654;</span>
        <span>{description}</span>
      </summary>
      {input ? (
        <div className="cb-scroll-fade-bottom mt-1 mb-1 ml-3 max-h-40 overflow-auto rounded bg-warm-50 p-3">
          <JsonView value={input} />
        </div>
      ) : null}
      {result ? (
        <>
          <div className="text-[10px] uppercase tracking-wider text-warm-500 ml-3 mt-1">result</div>
          <Pre size="xs" boxed scroll="sm" className="cb-scroll-fade-bottom mt-0.5 mb-1 ml-3">
            {result}
          </Pre>
        </>
      ) : null}
    </details>
  );
}

function countToolCalls(parts: ActivityParts): number {
  let count = 0;
  for (const part of parts) {
    switch (part.type) {
      case "thinking":
        count++;
        break;
      case "tools":
        count += part.tools.length;
        break;
    }
  }
  return count;
}

export function ThinkingCornerMark() {
  return (
    <span
      title="Agent reasoned silently (no thinking text recorded)"
      aria-label="thought"
      className="inline-flex items-center text-primary opacity-40"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
        <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2v1.3h6v-1.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z" />
      </svg>
    </span>
  );
}

function ActivityGroupInner({ parts }: { parts: ActivityParts }) {
  return (
    <>
      {parts.map((part, i) => {
        switch (part.type) {
          case "thinking":
            if (!part.text?.trim()) return null;
            return (
              <details key={i} className="group/think">
                <summary className="cursor-pointer list-none flex items-center gap-1 text-primary hover:text-primary-dark py-0.5">
                  <span className="text-warm-500 group-open/think:rotate-90 transition-transform text-[10px]">&#9654;</span>
                  <span>thinking</span>
                </summary>
                <div className="mt-0.5 mb-1 ml-3 text-xs text-warm-600 italic whitespace-pre-wrap">
                  {part.text}
                </div>
              </details>
            );
          case "tools":
            return part.tools.map((tool, j) => <ToolDetail key={`${i}-${j}`} block={tool} />);
        }
      })}
    </>
  );
}

/**
 * Render a collapsible activity group (thinking + tool calls).
 * Single-item groups render the item directly without a wrapper.
 */
export function ActivityGroup({ parts }: { parts: ActivityParts }) {
  if (parts.length === 0) return null;

  const totalItems = countToolCalls(parts);

  // Single item: render directly without the collapsible group wrapper
  if (totalItems === 1) {
    return (
      <div className="text-xs text-warm-600 leading-tight my-1 ml-2 pl-2 border-l border-warm-300">
        <ActivityGroupInner parts={parts} />
      </div>
    );
  }

  const summary = summarizeActivity(parts);

  return (
    <details className="group my-1 ml-2 pl-2 border-l border-warm-300">
      <summary className="cursor-pointer list-none flex items-center gap-1 text-xs text-warm-600 hover:text-warm-700">
        <span className="text-warm-500 group-open:rotate-90 transition-transform text-[10px]">&#9654;</span>
        <span>{summary}</span>
      </summary>
      <div className="mt-1 text-xs text-warm-600 leading-tight ml-1">
        <ActivityGroupInner parts={parts} />
      </div>
    </details>
  );
}
