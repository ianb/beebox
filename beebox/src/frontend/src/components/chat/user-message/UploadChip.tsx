/**
 * Compact upload chip — how a delivered `<upload>` user message renders in the
 * transcript. Sibling of `CaptureChip`.
 *
 * The boxholder's own introduction renders as their words, above the batch
 * metadata — not folded into a label. It IS the message they wrote; the counts
 * are the machine's annotation of it. Before this existed the whole wrapper fell
 * through to the plain-text renderer and their introduction appeared inside
 * literal `<upload …>` markup in their own chat log.
 */

import type { UploadChipModel } from "./upload-message";
import { CaptureBadge } from "../CaptureChip";
import { AttachmentChipFrame } from "../AttachmentChipFrame";

export function UploadChip({ model }: { model: UploadChipModel }) {
  const fileLabel = `${String(model.files)} file${model.files === 1 ? "" : "s"}`;
  const sizeLabel = model.bytes === "" ? "" : ` · ${model.bytes}`;
  return (
    <div>
      {model.note !== "" ? (
        <div className="text-sm whitespace-pre-wrap mb-1.5">{model.note}</div>
      ) : null}
      <AttachmentChipFrame
        doc={model.doc}
        title={`Uploaded ${fileLabel}${sizeLabel}`}
        summary={model.summary}
        icon={
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
          </svg>
        }
      >
        {model.failed > 0 ? (
          <div className="mt-1">
            <CaptureBadge label={`${String(model.failed)} failed`} />
          </div>
        ) : null}
      </AttachmentChipFrame>
    </div>
  );
}
