/**
 * How a delivered `<trigger>` renders in the transcript
 * (plan:activity-triggers, Track E): a labeled aside, the trigger's
 * label as the eyebrow and its text as the body. Modeled on the self-note
 * aside: it is a message nobody typed. The note is for the agent and is not
 * rendered (an open design question in the plan).
 */

import type { TriggerUserMessage } from "@shared/delivered-trigger-message";

export function TriggerChip({ model }: { model: TriggerUserMessage }) {
  return (
    <div className="bbx-chat-user-attachment rounded-lg bg-black/15 px-3 py-2" data-trigger-label={model.label}>
      <div className="mb-1 flex items-center gap-2 text-[0.6875rem] uppercase tracking-wider opacity-80">
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path d="M13 2 4 14h7l-1 8 9-12h-7z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{model.label}</span>
      </div>
      <div className="text-sm whitespace-pre-wrap break-words">{model.text}</div>
    </div>
  );
}
