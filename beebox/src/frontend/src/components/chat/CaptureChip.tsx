/**
 * Compact capture chip (Track 4) — how a delivered `<capture>` user message
 * renders in the transcript. Shows the media label ("Capture — N photos, M:SS
 * audio"), the one-line summary, and partial / transcription-failed badges, and
 * links to the capture document card so the user (and agent) can open it.
 */

import { useParams } from "@tanstack/react-router";
import { withBase } from "../../api";
import type { CaptureChipModel } from "./capture-message";
import { captureChipLabel } from "./capture-message";

function CaptureBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
      {label}
    </span>
  );
}

export function CaptureChip({ model }: { model: CaptureChipModel }) {
  const { boxSlug } = useParams({ strict: false });
  const href = withBase(`/${boxSlug ?? ""}/browse/${model.doc}`);
  return (
    <a href={href} className="block rounded-lg bg-white/10 px-3 py-2 hover:bg-white/20">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <circle cx="12" cy="13" r="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{captureChipLabel(model)}</span>
      </div>
      {model.summary !== "" ? <div className="mt-0.5 text-xs text-white/85">{model.summary}</div> : null}
      {model.partial || model.transcriptionFailed ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {model.partial ? <CaptureBadge label="partial" /> : null}
          {model.transcriptionFailed ? <CaptureBadge label="transcription failed" /> : null}
        </div>
      ) : null}
    </a>
  );
}
