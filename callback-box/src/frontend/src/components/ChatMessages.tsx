/**
 * Shared message rendering components for chat UI.
 *
 * Used by both the interactive ChatPage and the read-only SessionViewer.
 */

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SessionEntry, SessionContentBlock } from "../api";

/**
 * Render user message text with keyword pills (e.g. send-message).
 */
function UserMessageText({ text }: { text: string }) {
  const stripped = text
    .replace(/<typed[^>]*>/gi, "")
    .replace(/<\/typed>/gi, "")
    .replace(/<speech[^>]*>/gi, "")
    .replace(/<\/speech>/gi, "");

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
  return result.trim();
}

/**
 * Render a tool use block (collapsed by default).
 */
export function ToolList({ blocks }: { blocks: SessionContentBlock[] }) {
  if (blocks.length === 0) return null;
  return (
    <div className="text-xs text-warm-600 leading-tight my-1 ml-2 pl-2 border-l border-warm-400">
      {blocks.map((block, i) => (
        <details key={i} className="group">
          <summary className="cursor-pointer list-none flex items-center gap-1 hover:text-warm-700">
            <span className="text-warm-500 group-open:rotate-90 transition-transform text-[10px]">&#9654;</span>
            <span className="font-medium text-warm-700">{block.toolName}</span>
            {block.inputSummary && block.inputSummary !== block.toolName ? (
              <span className="ml-0.5">{block.inputSummary}</span>
            ) : null}
          </summary>
          {block.input ? (
            <pre className="mt-1 mb-1 ml-3 text-[11px] text-warm-500 bg-warm-50 rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap">
              {JSON.stringify(block.input, null, 2)}
            </pre>
          ) : null}
        </details>
      ))}
    </div>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  if (!text) return null;
  return (
    <details className="group my-1 ml-2 pl-2 border-l border-plum-100">
      <summary className="cursor-pointer list-none flex items-center gap-1 text-xs text-plum hover:text-plum-dark">
        <span className="group-open:rotate-90 transition-transform text-[10px]">&#9654;</span>
        thinking
      </summary>
      <div className="mt-1 text-xs text-warm-600 whitespace-pre-wrap max-h-60 overflow-auto">
        {text}
      </div>
    </details>
  );
}

/**
 * Render markdown content with prose styling.
 */
function MarkdownContent({ text }: { text: string }) {
  const cleaned = useMemo(() => stripSpeechTags(text), [text]);

  if (!cleaned) return null;

  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleaned}</ReactMarkdown>
    </div>
  );
}

/**
 * Group consecutive messages by role for merged display.
 */
export function groupMessages(entries: SessionEntry[]): Array<{ type: "user" | "assistant"; entries: SessionEntry[] }> {
  const groups: Array<{ type: "user" | "assistant"; entries: SessionEntry[] }> = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.type === entry.type) {
      last.entries.push(entry);
    } else {
      groups.push({ type: entry.type, entries: [entry] });
    }
  }
  return groups;
}

/**
 * Render a user message bubble.
 */
export function UserMessage({ entries, debugView }: { entries: SessionEntry[]; debugView?: boolean }) {
  return (
    <div className="flex justify-end pl-12 sm:pl-24 py-1">
      <div className="rounded-l-2xl bg-iris text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px]">
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
export function AssistantMessage({ entries, debugView }: { entries: SessionEntry[]; debugView?: boolean }) {
  const parts: Array<{ type: "text" | "tools" | "thinking"; text?: string; tools?: SessionContentBlock[] }> = [];

  for (const entry of entries) {
    for (const block of entry.content) {
      if (block.type === "thinking") {
        parts.push({ type: "thinking", text: block.text });
      } else if (block.type === "text" && block.text?.trim()) {
        parts.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        const last = parts[parts.length - 1];
        if (last && last.type === "tools") {
          last.tools!.push(block);
        } else {
          parts.push({ type: "tools", tools: [block] });
        }
      }
    }
  }

  return (
    <div className="pr-4 sm:pr-24 pl-3 sm:pl-6 py-2">
      {parts.map((part, i) =>
        part.type === "thinking" ? (
          <ThinkingBlock key={i} text={part.text ?? ""} />
        ) : part.type === "text" ? (
          debugView ? (
            <pre key={i} className="font-mono text-xs whitespace-pre-wrap bg-warm-50 text-warm-800 p-2 rounded">
              {part.text ?? ""}
            </pre>
          ) : (
            <MarkdownContent key={i} text={part.text ?? ""} />
          )
        ) : (
          <ToolList key={i} blocks={part.tools ?? []} />
        )
      )}
    </div>
  );
}

/**
 * Render markdown content — exported for StreamingMessage in ChatPage.
 */
export { MarkdownContent };
