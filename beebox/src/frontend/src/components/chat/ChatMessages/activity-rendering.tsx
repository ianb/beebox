/**
 * Rendering of assistant "activity" — tool calls and thinking blocks —
 * including the collapsed summaries used in the chat transcript.
 */

import { Pre } from "../../ui/Pre";
import { JsonView } from "../../ui/JsonView";
import { InlineAction } from "../../ui/InlineAction";
import { useWorkspace } from "../workspace/WorkspaceProvider/provider";
import { cardTarget } from "../workspace/use-open-beside/hook";
import type { SessionContentBlock } from "../../../api";
import type { ActivityPart } from "../assistant-parts";
import { type Excerpt, type ToolCallDetail, describeToolCall, describeToolDetail, summarizeActivity } from "./activity-wording";

type ActivityParts = ActivityPart[];

/** The raw tool input and result: the deepest level of a line. */
function RawToolDetail({ block }: { block: SessionContentBlock }) {
  const input = block.input;
  const result = block.resultSummary;
  return (
    <>
      {input ? (
        <div className="bbx-scroll-fade-bottom mt-1 mb-1 ml-3 max-h-40 overflow-auto rounded bg-warm-50 p-3 bbx-chat-plate">
          <JsonView value={input} />
        </div>
      ) : null}
      {result ? (
        <>
          <div className="text-[10px] uppercase tracking-wider text-card-soft ml-3 mt-1">result</div>
          <Pre size="xs" boxed scroll="sm" className="bbx-chat-plate bbx-scroll-fade-bottom mt-0.5 mb-1 ml-3">
            {result}
          </Pre>
        </>
      ) : null}
    </>
  );
}

/** The plain excerpt under a line: what an edit replaced, or a labelled snippet. Spans, so it can sit in a `<summary>`. */
function ExcerptView({ excerpt }: { excerpt: Excerpt }) {
  switch (excerpt.kind) {
    case "change":
      return (
        <span className="block mb-1 ml-3 space-y-0.5 whitespace-pre-wrap break-words">
          {excerpt.before ? <span className="block text-card-soft line-through">{excerpt.before}</span> : null}
          {excerpt.after ? <span className="block text-card-ink">{excerpt.after}</span> : null}
          {excerpt.everywhere ? <span className="block text-card-soft italic">(every place it appeared)</span> : null}
        </span>
      );
    case "text":
      return (
        <span className="block mb-1 ml-3">
          <span className="text-card-soft">{excerpt.label}: </span>
          <span className="text-card-ink whitespace-pre-wrap break-words">{excerpt.text}</span>
        </span>
      );
  }
}

/**
 * The line's sentence, with the changed file's name as a link that opens it
 * in the workspace. Plain text where there is no workspace to open it in, or
 * nothing to open.
 */
function ToolSentence({ description, opens }: { description: string; opens: ToolCallDetail["opens"] }) {
  const workspace = useWorkspace();
  const at = opens === null ? -1 : description.lastIndexOf(opens.name);
  if (workspace === null || opens === null || at === -1) return <span>{description}</span>;
  return (
    <span>
      {description.slice(0, at)}
      <InlineAction
        intent="subtle"
        material
        title={`Open ${opens.name}`}
        onClick={(event) => {
          // Inside the line's <summary>: open the file without toggling the line.
          event.preventDefault();
          event.stopPropagation();
          workspace.open(cardTarget(opens.path), { label: opens.name });
        }}
      >
        {opens.name}
      </InlineAction>
      {description.slice(at + opens.name.length)}
    </span>
  );
}

/**
 * Render a single tool call: the plain-language line, its place, and, in an
 * expanded list, the plain excerpt under it. The excerpt sits inside the
 * summary so the opened raw input and result come after it. A lone step's
 * line is the collapsed view, so its excerpt waits behind the line's click.
 */
function ToolDetail({ block, excerptInline }: { block: SessionContentBlock; excerptInline: boolean }) {
  const description = describeToolCall(block);
  const { place, failed, excerpt, opens } = describeToolDetail(block);

  return (
    <details className="group/tool">
      <summary className="cursor-pointer list-none hover:text-card-soft py-0.5">
        <span className="flex flex-wrap items-center gap-x-1">
          <span className="text-card-soft group-open/tool:rotate-90 transition-transform text-[10px]">&#9654;</span>
          <ToolSentence description={description} opens={opens} />
          {place ? <span className="text-card-soft">· {place}</span> : null}
          {failed ? <span className="text-card-soft">· didn’t go through</span> : null}
        </span>
        {excerpt && excerptInline ? <ExcerptView excerpt={excerpt} /> : null}
      </summary>
      {excerpt && !excerptInline ? <ExcerptView excerpt={excerpt} /> : null}
      <RawToolDetail block={block} />
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
      case "note":
        break;
    }
  }
  return count;
}

function ActivityGroupInner({ parts, excerptInline }: { parts: ActivityParts; excerptInline: boolean }) {
  return (
    <>
      {parts.map((part, i) => {
        switch (part.type) {
          case "thinking":
            if (!part.text?.trim()) return null;
            return (
              <details key={i} className="group/think">
                <summary className="cursor-pointer list-none flex items-center gap-1 text-card-pen hover:text-card-ink py-0.5">
                  <span className="text-card-soft group-open/think:rotate-90 transition-transform text-[10px]">&#9654;</span>
                  <span>thought it over</span>
                </summary>
                <div className="mt-0.5 mb-1 ml-3 text-xs text-card-soft italic whitespace-pre-wrap">
                  {part.text}
                </div>
              </details>
            );
          case "tools":
            return part.tools.map((tool, j) => <ToolDetail key={`${i}-${j}`} block={tool} excerptInline={excerptInline} />);
          case "note":
            return <p key={i} className="my-1 text-card-pen whitespace-pre-wrap">{part.text}</p>;
        }
      })}
    </>
  );
}

/**
 * Render a collapsible activity group (thinking, tool calls, folded notes).
 * A single step with no notes renders directly without a wrapper.
 */
export function ActivityGroup({ parts }: { parts: ActivityParts }) {
  if (parts.length === 0) return null;

  const totalItems = countToolCalls(parts);

  // Single step: render directly without the collapsible group wrapper. A
  // note keeps the wrapper, so it stays folded.
  if (totalItems === 1 && !parts.some((part) => part.type === "note")) {
    return (
      <div className="text-xs text-card-soft leading-tight my-1 ml-2 pl-2 border-l border-warm-300">
        <ActivityGroupInner parts={parts} excerptInline={false} />
      </div>
    );
  }

  const summary = summarizeActivity(parts);

  return (
    <details className="group my-1 ml-2 pl-2 border-l border-warm-300">
      <summary className="cursor-pointer list-none flex items-center gap-1 text-xs text-card-soft hover:text-card-ink">
        <span className="text-card-soft group-open:rotate-90 transition-transform text-[10px]">&#9654;</span>
        <span>{summary}</span>
      </summary>
      <div className="mt-1 text-xs text-card-soft leading-tight ml-1">
        <ActivityGroupInner parts={parts} excerptInline />
      </div>
    </details>
  );
}
