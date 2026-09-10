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

import { useParams } from "@tanstack/react-router";
import { withBase } from "../../api";
import type { UploadChipModel } from "./upload-message";

export function UploadChip({ model }: { model: UploadChipModel }) {
  const { boxSlug } = useParams({ strict: false });
  const href = withBase(`/${boxSlug ?? ""}/browse/${model.doc}`);
  const fileLabel = `${String(model.files)} file${model.files === 1 ? "" : "s"}`;
  const sizeLabel = model.bytes === "" ? "" : ` · ${model.bytes}`;
  return (
    <div>
      {model.note !== "" ? (
        <div className="text-sm whitespace-pre-wrap mb-1.5">{model.note}</div>
      ) : null}
      <a href={href} className="bbx-chat-user-attachment block rounded-lg bg-white/10 px-3 py-2 hover:bg-white/20">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
          </svg>
          <span>Uploaded {fileLabel}{sizeLabel}</span>
        </div>
        {model.summary !== "" ? <div className="bbx-chat-user-attachment-summary mt-0.5 text-xs text-white/85">{model.summary}</div> : null}
        {model.failed > 0 ? (
          <div className="mt-1">
            <span className="bbx-chat-user-attachment-badge inline-flex items-center rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
              {model.failed} failed
            </span>
          </div>
        ) : null}
      </a>
    </div>
  );
}
