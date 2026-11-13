/**
 * How a delivered `<call>` renders in the transcript (docs/implemented-plans/chat-calls.md,
 * Track G): one summary line, "Call · Priya, Tomas · 12 min", that expands to
 * the folded transcript. Sibling of `UploadChip`; there is no card to link,
 * since the transcript lives in the message itself.
 */

import type { CallUserMessage } from "@shared/delivered-call-message";
import { Accordion } from "../../ui/Accordion";
import { CaptureBadge } from "../CaptureChip";

function lengthLabel(duration: string): string {
  const minutes = Number.parseInt(duration.split(":").at(0) ?? "0", 10);
  return Number.isNaN(minutes) || minutes < 1 ? "under a minute" : `${String(minutes)} min`;
}

function firstNames(people: string): string {
  return people
    .split(",")
    .map((name) => name.trim().split(/\s+/).at(0) ?? "")
    .filter((name) => name !== "")
    .join(", ");
}

export function CallChip({ model }: { model: CallUserMessage }) {
  const notes = [model.partial, model.skew].filter((note) => note !== null);
  return (
    <div className="bbx-chat-user-attachment rounded-lg bg-black/15 px-3 py-2">
      <Accordion variant="plain" title={<span className="text-sm font-medium">{`Call · ${firstNames(model.people)} · ${lengthLabel(model.duration)}`}</span>}>
        {model.partial !== null || model.skew !== null ? (
          <div className="mb-1 flex flex-wrap gap-1">
            {model.partial !== null ? <CaptureBadge label="partial" /> : null}
            {model.skew !== null ? <CaptureBadge label="clock skew" /> : null}
          </div>
        ) : null}
        {notes.map((note) => (
          <div key={note} className="bbx-chat-user-attachment-summary mb-1 text-xs text-white/85">{note}</div>
        ))}
        <div className="text-xs whitespace-pre-wrap">{model.transcript}</div>
      </Accordion>
    </div>
  );
}
