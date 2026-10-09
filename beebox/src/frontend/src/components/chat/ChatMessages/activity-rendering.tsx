/**
 * Rendering of assistant "activity" — tool calls and thinking blocks —
 * including the collapsed summaries used in the chat transcript.
 */

import { Pre } from "../../ui/Pre";
import { JsonView } from "../../ui/JsonView";
import type { SessionContentBlock } from "../../../api";
import type { ActivityPart } from "../message-parsing";
import { describeToolCall, summarizeActivity } from "./activity-wording";

type ActivityParts = ActivityPart[];

/**
 * Render a single tool call — the plain-language line expands to the raw input and result.
 */
function ToolDetail({ block }: { block: SessionContentBlock }) {
  const input = block.input;
  const result = block.resultSummary;
  const description = describeToolCall(block);

  return (
    <details className="group/tool">
      <summary className="cursor-pointer list-none flex items-center gap-1 hover:text-warm-700 py-0.5">
        <span className="text-warm-500 group-open/tool:rotate-90 transition-transform text-[10px]">&#9654;</span>
        <span>{description}</span>
      </summary>
      {input ? (
        <div className="bbx-scroll-fade-bottom mt-1 mb-1 ml-3 max-h-40 overflow-auto rounded bg-warm-50 p-3">
          <JsonView value={input} />
        </div>
      ) : null}
      {result ? (
        <>
          <div className="text-[10px] uppercase tracking-wider text-warm-500 ml-3 mt-1">result</div>
          <Pre size="xs" boxed scroll="sm" className="bbx-scroll-fade-bottom mt-0.5 mb-1 ml-3">
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
                  <span>thought it over</span>
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
