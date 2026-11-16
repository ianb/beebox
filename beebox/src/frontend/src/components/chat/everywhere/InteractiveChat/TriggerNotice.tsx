/**
 * A trigger notice as a system row: the watcher's label as the eyebrow, the
 * notice, and a link back to the card it is about ("return to what we're
 * talking about"), which opens that card beside the chat. Centered meta
 * material like the compaction marker, since nobody in the conversation
 * said it. The agent's follow-up, if any, is its own turn after this.
 */

import type { TriggerUserMessage } from "@shared/delivered-trigger-message";
import { useWorkspace } from "../../workspace/WorkspaceProvider/provider";
import { cardTitleOf } from "../../trigger-notice";

export function TriggerNotice({ model }: { model: TriggerUserMessage }) {
  const workspace = useWorkspace();
  const card = model.card;
  const open = card === null ? null : (): void => {
    if (workspace === null) { console.warn(`[trigger] no workspace to open ${card} in`); return; }
    workspace.open({ path: card, viewer: null, params: {}, viewState: null }, { label: cardTitleOf(card) });
  };
  return (
    <div className="flex justify-center py-2" data-trigger-notice={model.label}>
      <div className="bbx-chat-meta-material max-w-2xl rounded border-l-2 border-warm-300 bg-warm-50/60 px-3 py-2 text-sm text-card-soft">
        <div className="mb-1 flex items-center gap-2 text-[0.6875rem] uppercase tracking-wider">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path d="M13 2 4 14h7l-1 8 9-12h-7z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{model.label}</span>
          <span className="normal-case tracking-normal">· noticed</span>
        </div>
        <div className="whitespace-pre-wrap break-words text-card-ink">{model.text}</div>
        {open !== null && card !== null ? (
          <button type="button" onClick={open} className="mt-1 text-xs underline decoration-dotted hover:text-card-ink">
            {`Open ${cardTitleOf(card)}`}
          </button>
        ) : null}
      </div>
    </div>
  );
}
