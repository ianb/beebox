/**
 * Shared message rendering components for chat UI.
 *
 * Used by both the interactive ChatPage and the read-only SessionViewer.
 */

import { useMemo, useState } from "react";
import { Markdown } from "./Markdown";
import { ImageLightbox } from "./ImageLightbox";
import { ViewRenderer } from "./ViewRenderer";
import type { Components } from "react-markdown";
import { getApiBase } from "../api";
import type { SessionEntry, SessionContentBlock } from "../api";

/**
 * Render user message text with keyword pills (e.g. send-message).
 */
/**
 * Strip system-injected tags from user message text for display.
 */
function stripUserDisplayTags(text: string): string {
  return text
    .replace(/<typed[^>]*>/gi, "")
    .replace(/<\/typed>/gi, "")
    .replace(/<speech[^>]*>/gi, "")
    .replace(/<\/speech>/gi, "")
    .replace(/<pending-schedules>[\S\s]*?<\/pending-schedules>/gi, "")
    .replace(/<schedule-fired[\S\s]*?<\/schedule-fired>/gi, "");
}

/**
 * Extract user name from a session entry.
 * Checks the entry's user field first, then parses from tag attributes.
 */
function getUserName(entry: SessionEntry): string | null {
  if (entry.user) return entry.user;
  const firstText = entry.content.find((b) => b.type === "text")?.text || "";
  const match = firstText.match(/<(?:typed|speech)\b[^>]*\buser="([^"]*)"/);
  if (match) return match[1].replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
  return null;
}

function UserMessageText({ text }: { text: string }) {
  const stripped = stripUserDisplayTags(text);

  const parts: Array<{ type: "text"; value: string } | { type: "send"; phrase: string }> = [];
  const tagRe = /<send-message\s+phrase="([^"]*?)"\s*\/>/gi;
  let lastIndex = 0;
  let match;
  while ((match = tagRe.exec(stripped)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: stripped.slice(lastIndex, match.index) });
    }
    parts.push({ type: "send", phrase: match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&") });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < stripped.length) {
    parts.push({ type: "text", value: stripped.slice(lastIndex) });
  }

  const hasPill = parts.some((p) => p.type === "send");
  if (!hasPill) {
    return <>{stripped.trim()}</>;
  }

  return (
    <>
      {parts.map((p, i) =>
        p.type === "text" ? (
          <span key={i}>{p.value}</span>
        ) : (
          <span key={i} className="inline-flex items-center gap-1 bg-white/20 rounded-full px-2 py-0.5 text-xs font-medium">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            {p.phrase}
          </span>
        )
      )}
    </>
  );
}

/**
 * Strip speech tags and instructions from assistant content for markdown rendering.
 */
function stripSpeechTags(content: string): string {
  let result = content.replace(/<instructions>[\S\s]*?<\/instructions>/gi, "");
  result = result.replace(/<speech[^>]*>/gi, "");
  result = result.replace(/<\/speech>/gi, "");
  result = result.replace(/<schedule[\S\s]*?<\/schedule>/gi, "");
  result = result.replace(/<cancel-schedule[^>]*>/gi, "");
  return result.trim();
}

/**
 * Human-readable description of a single tool call.
 */
const toolDescribers: Record<string, (input: Record<string, unknown>, block: SessionContentBlock) => string> = {
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
};

/** Tools that are boring enough to not need an expandable details view */
const nonExpandableTools = new Set(["Read", "Glob"]);

function describeToolCall(block: SessionContentBlock): string {
  const input = block.input || {};
  const describer = toolDescribers[block.toolName || ""];
  if (describer) return describer(input, block);
  return block.inputSummary || block.toolName || "Tool call";
}

function shortPath(p: string): string {
  const parts = p.split("/");
  if (parts.length <= 2) return p;
  return parts.slice(-2).join("/");
}

/**
 * Summarize an activity group (thinking + tools) for the collapsed header.
 */
function summarizeActivity(parts: Array<{ type: "thinking" | "tools"; text?: string; tools?: SessionContentBlock[] }>): string {
  const segments: string[] = [];
  let hasThinking = false;

  const counts: Record<string, number> = {};
  for (const part of parts) {
    if (part.type === "thinking") {
      hasThinking = true;
    } else if (part.tools) {
      for (const tool of part.tools) {
        const category = toolCategory(tool.toolName || "");
        counts[category] = (counts[category] || 0) + 1;
      }
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

function toolCategory(name: string): string {
  switch (name) {
    case "Read": return "read";
    case "Edit":
    case "Write": return "edit";
    case "Bash": return "command";
    case "Grep":
    case "Glob": return "search";
    case "Agent":
    case "Task": return "task";
    case "TodoWrite": return "todo";
    default: return "tool";
  }
}

function categorySingular(cat: string): string {
  switch (cat) {
    case "read": return "read a file";
    case "edit": return "edited a file";
    case "command": return "ran a command";
    case "search": return "searched code";
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
        <pre className="mt-1 mb-1 ml-3 text-[11px] text-warm-500 bg-warm-50 rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap">
          {JSON.stringify(input, null, 2)}
        </pre>
      ) : null}
    </details>
  );
}

function countToolCalls(parts: Array<{ type: "thinking" | "tools"; text?: string; tools?: SessionContentBlock[] }>): number {
  let count = 0;
  for (const part of parts) {
    if (part.type === "thinking") {
      count++;
    } else if (part.tools) {
      count += part.tools.length;
    }
  }
  return count;
}

function ActivityGroupInner({ parts }: { parts: Array<{ type: "thinking" | "tools"; text?: string; tools?: SessionContentBlock[] }> }) {
  return (
    <>
      {parts.map((part, i) =>
        part.type === "thinking" ? (
          <details key={i} className="group/think">
            <summary className="cursor-pointer list-none flex items-center gap-1 text-plum hover:text-plum-dark py-0.5">
              <span className="group-open/think:rotate-90 transition-transform text-[10px]">&#9654;</span>
              thinking
            </summary>
            <div className="mt-1 text-xs text-warm-600 whitespace-pre-wrap max-h-60 overflow-auto ml-3">
              {part.text}
            </div>
          </details>
        ) : (
          part.tools?.map((tool, j) => <ToolDetail key={`${i}-${j}`} block={tool} />)
        )
      )}
    </>
  );
}

/**
 * Render a collapsible activity group (thinking + tool calls).
 * Single-item groups render the item directly without a wrapper.
 */
export function ActivityGroup({ parts }: { parts: Array<{ type: "thinking" | "tools"; text?: string; tools?: SessionContentBlock[] }> }) {
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

/**
 * Render a collapsed tool list (used during streaming when we don't have full context).
 * Shows as a collapsed summary matching the post-completion ActivityGroup style.
 */
export function ToolList({ blocks }: { blocks: SessionContentBlock[] }) {
  if (blocks.length === 0) return null;
  const summary = summarizeActivity([{ type: "tools", tools: blocks }]);
  return (
    <details className="group my-1 ml-2 pl-2 border-l border-warm-300">
      <summary className="cursor-pointer list-none flex items-center gap-1 text-xs text-warm-600 hover:text-warm-700">
        <span className="text-warm-500 group-open:rotate-90 transition-transform text-[10px]">&#9654;</span>
        <span>{summary}…</span>
      </summary>
      <div className="mt-1 text-xs text-warm-600 leading-tight ml-1">
        {blocks.map((block, i) => (
          <ToolDetail key={i} block={block} />
        ))}
      </div>
    </details>
  );
}


/**
 * Clickable image thumbnail that opens a lightbox on click.
 */
function ChatImage({ src, alt }: { src: string; alt: string }) {
  const [lightbox, setLightbox] = useState(false);

  return (
    <>
      <img
        src={src}
        alt={alt}
        className="max-w-xs max-h-64 rounded shadow-md cursor-pointer hover:opacity-90 transition-opacity"
        onClick={() => setLightbox(true)}
        title="Click to zoom"
      />
      {lightbox ? (
        <ImageLightbox src={src} alt={alt} onClose={() => setLightbox(false)} />
      ) : null}
    </>
  );
}

/**
 * Extract image elements from a paragraph's children.
 * Returns the list of {src, alt} if ALL children are images (or whitespace text),
 * or null if the paragraph has non-image content.
 */
function extractImages(children: React.ReactNode): Array<{ src: string; alt: string }> | null {
  const images: Array<{ src: string; alt: string }> = [];
  const childArray = Array.isArray(children) ? children : [children];

  for (const child of childArray) {
    if (typeof child === "string" && child.trim() === "") continue;
    if (
      child !== null &&
      typeof child === "object" &&
      "type" in child &&
      child.type === "img" &&
      child.props
    ) {
      images.push({ src: child.props.src || "", alt: child.props.alt || "" });
      continue;
    }
    return null;
  }

  return images.length > 0 ? images : null;
}

/**
 * Paragraph override that detects image-only paragraphs and renders them
 * as centered thumbnails (single) or a grid (multiple).
 */
function ChatParagraph({ children, node: _node, ...props }: React.HTMLAttributes<HTMLParagraphElement> & { node?: unknown }) {
  const images = extractImages(children);

  if (images) {
    if (images.length === 1) {
      return (
        <div className="flex justify-center my-2">
          <ChatImage src={images[0].src} alt={images[0].alt} />
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 gap-2 my-2 justify-items-center">
        {images.map((img, i) => (
          <ChatImage key={i} src={img.src} alt={img.alt} />
        ))}
      </div>
    );
  }

  return <p {...props}>{children}</p>;
}

const chatMarkdownComponents: Partial<Components> = {
  p: ChatParagraph,
  a({ href, children, node: _node, ...props }) {
    if (href && href.startsWith("view:")) {
      const rest = href.slice("view:".length);
      const qIndex = rest.indexOf("?");
      const slug = qIndex !== -1 ? rest.slice(0, qIndex) : rest;
      const params: Record<string, string> = {};
      if (qIndex !== -1) {
        const search = new URLSearchParams(rest.slice(qIndex + 1));
        for (const [key, value] of search.entries()) {
          params[key] = value;
        }
      }
      return <ViewRenderer slug={slug} mode="chat" params={params} />;
    }
    return <a href={href} {...props}>{children}</a>;
  },
};

/**
 * Render markdown content with prose styling.
 */
function MarkdownContent({ text }: { text: string }) {
  const cleaned = useMemo(() => stripSpeechTags(text), [text]);

  if (!cleaned) return null;

  return (
    <div className="prose prose-sm max-w-none">
      <Markdown components={chatMarkdownComponents}>{cleaned}</Markdown>
    </div>
  );
}

/**
 * Group consecutive messages by role for merged display.
 * Compaction entries always get their own group (never merged).
 */
export function groupMessages(entries: SessionEntry[]): Array<{ type: "user" | "assistant" | "compaction"; entries: SessionEntry[] }> {
  const groups: Array<{ type: "user" | "assistant" | "compaction"; entries: SessionEntry[] }> = [];
  for (const entry of entries) {
    if (entry.type === "compaction") {
      groups.push({ type: "compaction", entries: [entry] });
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && last.type === entry.type) {
      last.entries.push(entry);
    } else {
      groups.push({ type: entry.type, entries: [entry] });
    }
  }
  return groups;
}

// --- Task notification handling ---

interface TaskNotification {
  taskId: string;
  status: string;
  summary: string;
  outputFile?: string;
}

function parseTaskNotification(text: string): TaskNotification | null {
  const match = text.match(/<task-notification>[\S\s]*?<task-id>([^<]*)<\/task-id>[\S\s]*?<status>([^<]*)<\/status>[\S\s]*?<summary>([^<]*)<\/summary>[\S\s]*?<\/task-notification>/);
  if (!match) return null;
  const outputMatch = text.match(/<output-file>([^<]*)<\/output-file>/);
  return {
    taskId: match[1]!,
    status: match[2]!,
    summary: match[3]!,
    outputFile: outputMatch ? outputMatch[1] : undefined,
  };
}

function TaskNotificationMessage({ notification }: { notification: TaskNotification }) {
  const [expanded, setExpanded] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [loadingOutput, setLoadingOutput] = useState(false);
  const statusColor = notification.status === "completed"
    ? "text-green-600"
    : notification.status === "error" ? "text-red-600" : "text-warm-600";

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && output === null && notification.outputFile) {
      setLoadingOutput(true);
      fetch(`${getApiBase()}/task-output?file=${encodeURIComponent(notification.outputFile)}`)
        .then((res) => {
          if (res.ok) return res.text();
          return null;
        })
        .then((text) => {
          setOutput(text ?? "(output no longer available)");
          setLoadingOutput(false);
        })
        .catch(() => {
          setOutput("(failed to load output)");
          setLoadingOutput(false);
        });
    }
  };

  return (
    <div className="py-1">
      <div className="flex justify-center">
        <button
          onClick={handleExpand}
          className="text-xs text-warm-500 hover:text-warm-700 bg-warm-50 rounded-full px-3 py-1 flex items-center gap-1.5"
        >
          <span className={statusColor}>&#x25CF;</span>
          {notification.summary}
          <span className="text-warm-400">{expanded ? "▾" : "▸"}</span>
        </button>
      </div>
      {expanded ? (
        <div className="mx-4 mt-2 bg-warm-50 border border-warm-200 rounded-lg p-3 text-xs">
          {loadingOutput ? (
            <div className="text-warm-500 italic">Loading output...</div>
          ) : output ? (
            <pre className="whitespace-pre-wrap break-words text-warm-700 max-h-64 overflow-auto font-mono">
              {output}
            </pre>
          ) : (
            <div className="text-warm-500 italic">No output file</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Render a user message bubble.
 * When currentUserEmail is provided, messages from other users are styled differently.
 */
export function UserMessage({ entries, debugView, currentUserEmail }: { entries: SessionEntry[]; debugView?: boolean; currentUserEmail?: string }) {
  const allTexts = entries.flatMap((e) =>
    e.content.filter((b) => b.type === "text").map((b) => b.text ?? "")
  );

  // Hide schedule-fired messages entirely in normal view (they're system-injected)
  if (!debugView) {
    const allEmpty = allTexts.every((t) => stripUserDisplayTags(t).trim() === "");
    if (allEmpty) return null;
  }

  // Show task-notification messages as collapsed system info
  const taskNotification = parseTaskNotification(allTexts.join("\n"));
  if (taskNotification && !debugView) {
    return <TaskNotificationMessage notification={taskNotification} />;
  }

  const senderName = getUserName(entries[0]);
  const senderEmail = entries[0].userEmail;
  // Compare by email if available (same user across devices), fall back to name
  const isOtherUser = currentUserEmail
    ? senderEmail ? senderEmail !== currentUserEmail : senderName ? senderName !== currentUserEmail : false
    : false;

  if (isOtherUser) {
    // Other user's message: left-aligned with name label
    return (
      <div className="pr-12 sm:pr-24 py-1">
        <div className="text-xs text-warm-500 ml-3 sm:ml-6 mb-0.5">{senderName}</div>
        <div className="ml-3 sm:ml-6 rounded-r-2xl bg-plum text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px] w-fit break-words">
          {entries.map((entry) =>
            entry.content
              .filter((b) => b.type === "text")
              .map((block, i) =>
                debugView ? (
                  <pre key={`${entry.uuid}-${i}`} className="font-mono text-xs whitespace-pre-wrap">
                    {block.text ?? ""}
                  </pre>
                ) : (
                  <div key={`${entry.uuid}-${i}`} className="text-sm whitespace-pre-wrap">
                    <UserMessageText text={block.text ?? ""} />
                  </div>
                )
              )
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-end pl-12 sm:pl-24 py-1">
      <div className="rounded-l-2xl bg-iris text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px] break-words">
        {entries.map((entry) =>
          entry.content
            .filter((b) => b.type === "text")
            .map((block, i) =>
              debugView ? (
                <pre key={`${entry.uuid}-${i}`} className="font-mono text-xs whitespace-pre-wrap">
                  {block.text ?? ""}
                </pre>
              ) : (
                <div key={`${entry.uuid}-${i}`} className="text-sm whitespace-pre-wrap">
                  <UserMessageText text={block.text ?? ""} />
                </div>
              )
            )
        )}
      </div>
    </div>
  );
}

/**
 * Render a group of consecutive assistant messages merged together.
 */
interface AssistantPart { type: "text" | "tools" | "thinking"; text?: string; tools?: SessionContentBlock[] }
interface TextGroup { kind: "text"; text: string }
interface ActivityPart { type: "thinking" | "tools"; text?: string; tools?: SessionContentBlock[] }
interface ActivityGroupData { kind: "activity"; parts: ActivityPart[] }

/**
 * Group consecutive non-text parts (thinking, tools) into activity groups,
 * separated by text parts which render as normal markdown.
 */
function groupIntoParts(entries: SessionEntry[]): Array<TextGroup | ActivityGroupData> {
  const flat: AssistantPart[] = [];
  for (const entry of entries) {
    for (const block of entry.content) {
      if (block.type === "thinking") {
        flat.push({ type: "thinking", text: block.text });
      } else if (block.type === "text" && block.text?.trim()) {
        flat.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        const last = flat[flat.length - 1];
        if (last && last.type === "tools") {
          last.tools!.push(block);
        } else {
          flat.push({ type: "tools", tools: [block] });
        }
      }
    }
  }

  const grouped: Array<TextGroup | ActivityGroupData> = [];
  let activityBuf: ActivityPart[] = [];

  function flushActivity() {
    if (activityBuf.length > 0) {
      grouped.push({ kind: "activity", parts: activityBuf });
      activityBuf = [];
    }
  }

  for (const part of flat) {
    if (part.type === "text") {
      flushActivity();
      grouped.push({ kind: "text", text: part.text || "" });
    } else {
      activityBuf.push(part as ActivityPart);
    }
  }
  flushActivity();

  return grouped;
}

export function AssistantMessage({ entries, debugView }: { entries: SessionEntry[]; debugView?: boolean }) {
  const grouped = groupIntoParts(entries);

  return (
    <div className="pr-4 sm:pr-24 pl-3 sm:pl-6 py-2 min-w-0 overflow-hidden">
      {grouped.map((group, i) =>
        group.kind === "text" ? (
          debugView ? (
            <pre key={i} className="font-mono text-xs whitespace-pre-wrap bg-warm-50 text-warm-800 p-2 rounded">
              {group.text}
            </pre>
          ) : (
            <MarkdownContent key={i} text={group.text} />
          )
        ) : (
          <ActivityGroup key={i} parts={group.parts} />
        )
      )}
    </div>
  );
}

/**
 * Render a compaction notification as a collapsed details element.
 */
export function CompactionMessage({ entries }: { entries: SessionEntry[] }) {
  const text = entries
    .flatMap((e) => e.content.filter((b) => b.type === "text").map((b) => b.text ?? ""))
    .join("\n")
    .trim();

  return (
    <div className="flex justify-center py-2">
      <details className="text-xs text-warm-500 max-w-[80%]">
        <summary className="cursor-pointer text-center hover:text-warm-600">
          Context compacted
        </summary>
        {text && text !== "Conversation compacted" ? (
          <div className="mt-2 text-left bg-warm-50 rounded p-3 text-warm-600 whitespace-pre-wrap max-h-60 overflow-auto">
            {text}
          </div>
        ) : null}
      </details>
    </div>
  );
}

/**
 * Render markdown content — exported for StreamingMessage in ChatPage.
 */
export { MarkdownContent };
