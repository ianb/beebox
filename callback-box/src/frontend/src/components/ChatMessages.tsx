/**
 * Shared message rendering components for chat UI.
 */

import { useCallback, useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { Markdown } from "./Markdown";
import { Image } from "./ui/Image";
import { Pre } from "./ui/Pre";
import { FileView } from "./FileView";
import type { LightboxImage } from "./ImageLightbox";
import type { Components } from "react-markdown";
import { parseViewUrl, resolveImageSrc, type NavigateHint, type ViewTarget } from "../lib/view-url";
import { parseContextDirective } from "../lib/context-directive";
import { getApiBase } from "../api";
import type { SessionEntry, SessionContentBlock } from "../api";
import { hasAssistantSpeech } from "../lib/speech-parsing";

/**
 * Parse a self-note block out of user-position text. Self-notes are
 * agent-authored messages wrapped in `<self-note ref="..." commit="...">...</self-note>`
 * (see `cb chat self-note`). Returns null if the text is not a self-note.
 */
interface SelfNoteInfo {
  ref: string | null;
  commit: string | null;
  body: string;
}

function decodeXmlAttr(v: string): string {
  return v
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseSelfNotes(text: string): SelfNoteInfo[] | null {
  const re = /<self-note\b([^>]*)>([\S\s]*?)<\/self-note>/g;
  const notes: SelfNoteInfo[] = [];
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const between = text.slice(lastEnd, m.index);
    if (between.trim().length > 0) return null;
    const attrs = m[1] || "";
    const body = (m[2] || "").trim();
    const refMatch = attrs.match(/\bref="([^"]*)"/);
    const commitMatch = attrs.match(/\bcommit="([^"]*)"/);
    notes.push({
      ref: refMatch ? decodeXmlAttr(refMatch[1]!) : null,
      commit: commitMatch ? decodeXmlAttr(commitMatch[1]!) : null,
      body,
    });
    lastEnd = m.index + m[0].length;
  }
  if (notes.length === 0) return null;
  if (text.slice(lastEnd).trim().length > 0) return null;
  return notes;
}

function entrySelfNotes(entry: SessionEntry): SelfNoteInfo[] | null {
  if (entry.type !== "user") return null;
  for (const block of entry.content) {
    if (block.type !== "text") continue;
    const notes = parseSelfNotes(block.text || "");
    if (notes) return notes;
  }
  return null;
}

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
    .replace(/<schedule-fired[\S\s]*?<\/schedule-fired>/gi, "")
    .replace(/<attachments>[\S\s]*?<\/attachments>/gi, "");
}


/**
 * Extract file attachments from a user message's text. Looks for the
 * `<attachments>` block written by the chat composer and parses
 * `[fileN]: tmp/<timestamp>_<original-name>` reference lines.
 */
interface FileAttachmentRef {
  id: number;
  path: string;
  /** Best-effort original filename, recovered by stripping the timestamp prefix. */
  displayName: string;
}

const ATTACHMENTS_BLOCK_RE = /<attachments>([\S\s]*?)<\/attachments>/i;
const FILE_REF_LINE_RE = /\[file(\d+)]:\s*(\S+)/g;
const TMP_FILENAME_PREFIX_RE = /^tmp\/[^/_]+_(.+)$/;

function extractFileAttachments(text: string): FileAttachmentRef[] {
  const block = text.match(ATTACHMENTS_BLOCK_RE);
  if (!block) return [];
  const inner = block[1];
  const refs: FileAttachmentRef[] = [];
  for (const m of inner.matchAll(FILE_REF_LINE_RE)) {
    const id = parseInt(m[1], 10);
    const p = m[2];
    const stripped = p.match(TMP_FILENAME_PREFIX_RE);
    refs.push({
      id,
      path: p,
      displayName: stripped ? stripped[1] : p,
    });
  }
  return refs;
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
 *
 * Handles partial-streaming cases as well: an opened-but-not-yet-closed
 * `<instructions>` or `<schedule>` body is stripped through end-of-text,
 * and a trailing incomplete tag like `<spee` or `</instr` is hidden so
 * we don't flicker raw markup for a frame as deltas arrive.
 */
function stripSpeechTags(content: string): string {
  // Closed forms first.
  let result = content.replace(/<instructions>[\S\s]*?<\/instructions>/gi, "");
  result = result.replace(/<schedule[\S\s]*?<\/schedule>/gi, "");
  result = result.replace(/<speech[^>]*>/gi, "");
  result = result.replace(/<\/speech>/gi, "");
  result = result.replace(/<cancel-schedule[^>]*>/gi, "");
  // Streaming: unclosed instructions/schedule body — drop from the opening
  // tag through end-of-text. Safe on finalized text (no unclosed tags
  // expected there).
  result = result.replace(/<instructions>[\S\s]*$/i, "");
  result = result.replace(/<schedule\b[\S\s]*$/i, "");
  // Streaming: a trailing incomplete tag like `<spee` or `</instr` whose
  // closing `>` hasn't arrived yet. Match `<` (optionally with `/`)
  // followed by tag-name chars to end-of-string. The `[^<>]*` body keeps
  // a dangling `<a href="x` from leaking. Safe for `2 < 3` (no letter
  // after the `<`).
  result = result.replace(/<\/?[a-z][^<>]*$/i, "");
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
        <Pre size="xs" boxed scroll="sm" muted className="mt-1 mb-1 ml-3">
          {JSON.stringify(input, null, 2)}
        </Pre>
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
            <summary className="cursor-pointer list-none flex items-center gap-1 text-primary hover:text-primary-dark py-0.5">
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
 * Markdown image with chat-friendly sizing and lightbox behavior.
 * Used directly for inline images and re-used by image-only paragraphs.
 */
function ChatInlineImage({ src, alt }: { src: string; alt: string }) {
  return (
    <Image
      src={src}
      alt={alt}
      size="chat"
      lightbox
      className="block mx-auto my-2"
    />
  );
}

function ChatImage({ src, alt }: { src: string; alt: string }) {
  const hasCaption = alt.trim() !== "";
  return (
    <Image
      src={src}
      alt={alt}
      size="chat"
      lightbox
      caption={hasCaption ? alt : undefined}
      className="mx-auto"
    />
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
      (child.type === "img" || child.type === ChatInlineImage) &&
      child.props
    ) {
      images.push({ src: child.props.src || "", alt: child.props.alt || "" });
      continue;
    }
    return null;
  }

  return images.length > 0 ? images : null;
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"]);

function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot <= 0) return false;
  return IMAGE_EXTS.has(path.slice(dot).toLowerCase());
}

/**
 * Minimal hast node shape (from react-markdown's `node` prop) used for
 * paragraph inspection. Hast elements have `tagName` + `properties`; text
 * nodes have `value`.
 */
interface HastChild {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { href?: unknown; src?: unknown; alt?: unknown };
  children?: HastChild[];
}

function hastText(node: HastChild): string {
  if (node.type === "text") return node.value || "";
  if (!node.children) return "";
  return node.children.map(hastText).join("");
}

/**
 * Scan a paragraph's hast node for view: links that point at image files,
 * and return their resolved src+alt. Returns null if any non-image,
 * non-whitespace child is present — so we only take over when the paragraph
 * is exclusively view-image links.
 *
 * This is needed because react-markdown's custom `a` component wraps link
 * nodes in our handler function, so extractImages (which reads rendered
 * React children) can't see the underlying <img> our handler emits. We
 * inspect the source AST instead.
 */
function extractViewImagesFromNode(node: HastChild | undefined): Array<{ src: string; alt: string }> | null {
  if (!node || !node.children) return null;
  const images: Array<{ src: string; alt: string }> = [];
  for (const child of node.children) {
    if (child.type === "text" && (child.value || "").trim() === "") continue;
    if (
      child.type === "element" &&
      child.tagName === "a" &&
      typeof child.properties?.href === "string" &&
      child.properties.href.startsWith("view:")
    ) {
      const target = parseViewUrl(child.properties.href);
      if (isImagePath(target.path)) {
        images.push({
          src: `${getApiBase()}/files/${target.path}`,
          alt: hastText(child),
        });
        continue;
      }
    }
    return null;
  }
  return images.length > 0 ? images : null;
}

/**
 * Paragraph override that detects image-only paragraphs and renders them
 * as centered thumbnails (single) or a grid (multiple).
 */
function ChatParagraph({ children, node, ...props }: React.HTMLAttributes<HTMLParagraphElement> & { node?: unknown }) {
  const images = extractImages(children) ?? extractViewImagesFromNode(node as HastChild | undefined);

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

export type OnZoomView = (view: { target: ViewTarget; label: string }) => void;

function makeChatMarkdownComponents(
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void,
  { boxSlug, onZoomView }: { boxSlug: string | undefined; onZoomView?: OnZoomView },
): Partial<Components> {
  return {
    p: ChatParagraph,
    img({ src, alt }) {
      const resolved = src ? resolveImageSrc(src, { boxSlug, basePath: undefined }) : "";
      return <ChatInlineImage src={resolved} alt={alt || ""} />;
    },
    a({ href, children, node: _node, ...props }) {
      if (href && href.startsWith("view:")) {
        const target = parseViewUrl(href);
        // Image view: links render inline as an image with the same sizing
        // and lightbox behavior as markdown images.
        if (isImagePath(target.path)) {
          const alt = typeof children === "string" ? children : target.path;
          return <ChatInlineImage src={`${getApiBase()}/files/${target.path}`} alt={alt} />;
        }
        if (target.zoom && onZoomView) {
          const label = typeof children === "string" ? children : target.path;
          return (
            <button
              onClick={() => onZoomView({ target: { ...target, zoom: false }, label })}
              className="text-primary hover:text-primary/80 underline cursor-pointer"
            >
              {children}
            </button>
          );
        }
        return (
          <FileView
            path={target.path}
            mode="chat"
            rendererName={target.viewer}
            onNavigate={onNavigate}
          />
        );
      }
      const isExternal = typeof href === "string" && (href.startsWith("http://") || href.startsWith("https://"));
      if (isExternal) {
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
            <ExternalLinkIndicator />
          </a>
        );
      }
      return <a href={href} {...props}>{children}</a>;
    },
  };
}

function ExternalLinkIndicator() {
  return (
    <svg
      className="inline-block w-[0.85em] h-[0.85em] ml-0.5 align-[-0.1em] opacity-70"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
    </svg>
  );
}

/**
 * Render markdown content with prose styling.
 */
function MarkdownContent({ text, onZoomView }: { text: string; onZoomView?: OnZoomView }) {
  const cleaned = useMemo(() => stripSpeechTags(text), [text]);
  const { boxSlug } = useParams({ strict: false });
  const handleNavigate = useCallback(
    (target: ViewTarget) => {
      if (onZoomView) {
        onZoomView({ target: { ...target, zoom: false }, label: target.path });
      }
    },
    [onZoomView],
  );
  const components = useMemo(
    () => makeChatMarkdownComponents(handleNavigate, { boxSlug, onZoomView }),
    [handleNavigate, boxSlug, onZoomView],
  );

  if (!cleaned) return null;

  return (
    <div className="prose prose-sm max-w-none overflow-hidden">
      <Markdown components={components} onNavigate={handleNavigate}>{cleaned}</Markdown>
    </div>
  );
}

/**
 * Group consecutive messages by role for merged display.
 * Compaction entries always get their own group (never merged).
 * Self-notes (agent-authored user-position entries) also get their own
 * group — they should not merge with human-typed messages.
 */
export type MessageGroup =
  | { type: "user" | "assistant" | "compaction"; entries: SessionEntry[] }
  | { type: "self-note"; entries: SessionEntry[]; notes: SelfNoteInfo[] };

/**
 * Local-command entries are injected by the Claude CLI when slash commands
 * like /model or /compact run via stream-json. They appear as user-type
 * entries whose text is a bare `<local-command-caveat>`, `<command-name>`,
 * or `<local-command-stdout>` tag. We skip them in the rendered chat because
 * they clutter the transcript and say nothing the user cares about — the
 * relevant UI affordance (pill, compaction marker) is surfaced separately.
 */
function isLocalCommandEntry(entry: SessionEntry): boolean {
  if (entry.type !== "user") return false;
  const texts = entry.content.filter((b) => b.type === "text").map((b) => (b.text ?? "").trim());
  if (texts.length === 0) return false;
  return texts.every((t) =>
    t.startsWith("<local-command-caveat>") ||
    t.startsWith("<local-command-stdout>") ||
    t.startsWith("<command-name>"),
  );
}

export function groupMessages(entries: SessionEntry[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const entry of entries) {
    if (isLocalCommandEntry(entry)) continue;
    if (entry.type === "compaction") {
      groups.push({ type: "compaction", entries: [entry] });
      continue;
    }
    const notes = entrySelfNotes(entry);
    if (notes) {
      groups.push({ type: "self-note", entries: [entry], notes });
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && (last.type === "user" || last.type === "assistant") && last.type === entry.type) {
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
    ? "text-success"
    : notification.status === "error" ? "text-danger-dark" : "text-warm-600";

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
            <Pre size="xs" scroll="md">{output}</Pre>
          ) : (
            <div className="text-warm-500 italic">No output file</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Resolve an image block's source into a browser-usable URL.
 * Returns null if neither base64 data nor a URL is present.
 */
function imageBlockSrc(block: SessionContentBlock): string | null {
  if (block.dataBase64 && block.mediaType) {
    return `data:${block.mediaType};base64,${block.dataBase64}`;
  }
  if (block.imageUrl) return block.imageUrl;
  return null;
}

/**
 * Extract every image referenced in a chat — image content blocks plus
 * markdown `![](url)` and `view:` image links inside text blocks. The
 * result is the canonical, in-order list used by the lightbox so that
 * navigation works for messages that aren't currently mounted by the
 * virtualizer. Optional `streamText` appends still-streaming images so
 * the list stays accurate while a turn is in flight.
 */
export function extractChatImages(
  entries: SessionEntry[],
  { streamText, boxSlug }: { streamText: string | undefined; boxSlug: string | undefined },
): LightboxImage[] {
  const images: LightboxImage[] = [];
  let attachmentIndex = 0;
  for (const entry of entries) {
    for (const block of entry.content) {
      if (block.type === "image") {
        const src = imageBlockSrc(block);
        if (src) {
          attachmentIndex += 1;
          images.push({ src, alt: `Attached image ${attachmentIndex}` });
        }
      } else if (block.type === "text" && block.text) {
        extractImagesFromMarkdown(block.text, { out: images, boxSlug });
      }
    }
  }
  if (streamText) extractImagesFromMarkdown(streamText, { out: images, boxSlug });
  return images;
}

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;
const VIEW_LINK_RE = /\[([^\]]*)]\(view:([^\s)]+)\)/g;

function extractImagesFromMarkdown(
  text: string,
  { out, boxSlug }: { out: LightboxImage[]; boxSlug: string | undefined },
): void {
  for (const match of text.matchAll(MARKDOWN_IMAGE_RE)) {
    const alt = match[1];
    const rawSrc = match[2];
    if (rawSrc) {
      const src = resolveImageSrc(rawSrc, { boxSlug, basePath: undefined });
      const trimmedAlt = alt.trim();
      out.push({
        src,
        alt,
        caption: trimmedAlt === "" ? undefined : alt,
      });
    }
  }
  for (const match of text.matchAll(VIEW_LINK_RE)) {
    const label = match[1];
    const target = parseViewUrl(`view:${match[2]}`);
    if (isImagePath(target.path)) {
      out.push({
        src: `${getApiBase()}/files/${target.path}`,
        alt: label,
      });
    }
  }
}

/**
 * Thumbnail + lightbox for an inline image in a user message bubble.
 */
function MessageImage({ src, alt }: { src: string; alt: string }) {
  return <Image src={src} alt={alt} size="sm" lightbox bordered className="my-1" />;
}

/**
 * Inline chip showing an attached file with its original name. The path
 * sits in <boxRoot>/tmp/, gitignored and swept by housekeeping; we don't
 * link it because the chip is just a "you sent this" affordance.
 */
function MessageFileChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-warm-100 border border-warm-300 text-xs text-warm-800">
      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span className="truncate max-w-[16rem]">{name}</span>
    </span>
  );
}

/**
 * Render a user entry's content blocks: text blocks go through the normal
 * tag-stripping display, image blocks render as clickable thumbnails. File
 * attachments parsed from a sibling <attachments> block render as chips.
 */
function UserEntryContent({ entry, debugView }: { entry: SessionEntry; debugView: boolean }) {
  const fileRefs = entry.content
    .filter((b) => b.type === "text")
    .flatMap((b) => extractFileAttachments(b.text ?? ""));
  return (
    <>
      {entry.content.map((block, i) => {
        const key = `${entry.uuid}-${i}`;
        if (block.type === "text") {
          if (debugView) {
            return (
              <Pre key={key} size="xs">{block.text ?? ""}</Pre>
            );
          }
          return (
            <div key={key} className="text-sm whitespace-pre-wrap">
              <UserMessageText text={block.text ?? ""} />
            </div>
          );
        }
        if (block.type === "image") {
          const src = imageBlockSrc(block);
          if (!src) return null;
          return <MessageImage key={key} src={src} alt={`Attached image ${i + 1}`} />;
        }
        return null;
      })}
      {!debugView && fileRefs.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {fileRefs.map((f) => (
            <MessageFileChip key={f.id} name={f.displayName} />
          ))}
        </div>
      ) : null}
    </>
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
  const hasImages = entries.some((e) => e.content.some((b) => b.type === "image"));
  const hasFiles = allTexts.some((t) => extractFileAttachments(t).length > 0);

  // Hide schedule-fired messages entirely in normal view (they're system-injected)
  if (!debugView) {
    const allEmpty = allTexts.every((t) => stripUserDisplayTags(t).trim() === "");
    if (allEmpty && !hasImages && !hasFiles) return null;
  }

  // Show task-notification messages as collapsed system info
  const taskNotification = parseTaskNotification(allTexts.join("\n"));
  if (taskNotification && !debugView) {
    return <TaskNotificationMessage notification={taskNotification} />;
  }

  // Auto-seed messages from a landmark-started chat render as a chip,
  // not a bubble — they're context for the agent, not user speech.
  const contextDirective = parseContextDirective(allTexts);
  if (contextDirective && !debugView) {
    return <ContextDirectoryChip dir={contextDirective.dir} />;
  }

  const senderName = getUserName(entries[0]);
  const senderEmail = entries[0].userEmail;
  // Compare by email if available (same user across devices), fall back to name
  const isOtherUser = currentUserEmail
    ? senderEmail ? senderEmail !== currentUserEmail : senderName ? senderName !== currentUserEmail : false
    : false;

  const isPending = entries.every((e) => e.pending === true);
  const pendingClass = isPending ? " opacity-60" : "";
  const pendingTitle = isPending ? "Queued — waiting for agent" : undefined;

  if (isOtherUser) {
    // Other user's message: left-aligned with name label
    return (
      <div className="pr-12 sm:pr-24 py-1">
        <div className="text-xs text-warm-500 ml-3 sm:ml-6 mb-0.5">{senderName}</div>
        <div
          className={"ml-3 sm:ml-6 rounded-r-2xl bg-primary text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px] w-fit break-words" + pendingClass}
          title={pendingTitle}
        >
          {entries.map((entry) => (
            <UserEntryContent key={entry.uuid} entry={entry} debugView={debugView ?? false} />
          ))}
          {isPending ? <PendingIndicator /> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-end pl-12 sm:pl-24 py-1">
      <div
        className={"rounded-l-2xl bg-info text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px] break-words" + pendingClass}
        title={pendingTitle}
      >
        {entries.map((entry) => (
          <UserEntryContent key={entry.uuid} entry={entry} debugView={debugView ?? false} />
        ))}
        {isPending ? <PendingIndicator /> : null}
      </div>
    </div>
  );
}

function PendingIndicator() {
  return (
    <div className="text-xs text-white/70 mt-1 italic">queued — waiting</div>
  );
}

/**
 * Inline chip for the auto-seed context directive in landmark-started
 * chats. Replaces the user message bubble — the directive is system
 * context, not something the user said.
 */
function ContextDirectoryChip({ dir }: { dir: string }) {
  return (
    <div className="py-2 flex justify-center">
      <span
        className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-warm-100 text-warm-700 text-xs"
        title={`Familiarising with ${dir}/`}
      >
        <span aria-hidden>📍</span>
        Context: {dir}/
      </span>
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

function SpeechIcon({ playing, onStop }: { playing: boolean; onStop?: () => void }) {
  return (
    <svg
      onClick={playing ? onStop : undefined}
      role={playing ? "button" : undefined}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block w-4 h-4 align-text-bottom ${
        playing ? "text-primary animate-pulse cursor-pointer" : "text-primary opacity-40"
      }`}
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

export function AssistantMessage({ entries, debugView, speechPlaying, onStopSpeech, onZoomView }: { entries: SessionEntry[]; debugView?: boolean; speechPlaying?: boolean; onStopSpeech?: () => void; onZoomView?: OnZoomView }) {
  const grouped = groupIntoParts(entries);
  const allText = entries.flatMap((e) =>
    e.content.filter((b) => b.type === "text").map((b) => b.text ?? "")
  ).join("\n");
  const hasSpeech = hasAssistantSpeech(allText);
  const isPlaying = speechPlaying === true;

  return (
    <div className="pr-4 sm:pr-24 pl-3 sm:pl-6 py-2 min-w-0 overflow-hidden relative">
      {hasSpeech && !debugView ? (
        <div className="absolute right-2 top-2">
          <SpeechIcon playing={isPlaying} onStop={onStopSpeech} />
        </div>
      ) : null}
      {grouped.map((group, i) =>
        group.kind === "text" ? (
          debugView ? (
            <Pre key={i} size="xs" boxed>{group.text}</Pre>
          ) : (
            <MarkdownContent key={i} text={group.text} onZoomView={onZoomView} />
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
 * Render an agent-authored self-note. Distinct from user bubbles — it's
 * not conversational content; it's a background activity record.
 */
export function SelfNoteMessage({ note }: { note: SelfNoteInfo }) {
  const commitShort = note.commit ? note.commit.substring(0, 7) : null;
  return (
    <div className="py-2 px-3 sm:px-6">
      <div className="mx-auto max-w-2xl border-l-2 border-warm-300 bg-warm-50/60 rounded-r px-3 py-2 text-sm text-warm-700">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-warm-500 mb-1">
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M9 12h6M9 16h6M9 8h6M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-7-3-7 3z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>self-note</span>
          {note.ref ? (
            <span className="normal-case tracking-normal text-warm-500 truncate">· {note.ref}</span>
          ) : null}
          {commitShort ? (
            <span className="normal-case tracking-normal text-warm-500 font-mono">· {commitShort}</span>
          ) : null}
        </div>
        <div className="whitespace-pre-wrap break-words">{note.body}</div>
      </div>
    </div>
  );
}

/**
 * Render markdown content — exported for StreamingMessage in ChatPage.
 */
export { MarkdownContent };
