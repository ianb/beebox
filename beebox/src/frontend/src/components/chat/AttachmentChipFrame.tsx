/**
 * The frame every attachment chip in a user bubble shares (`CaptureChip`,
 * `UploadChip`, `QuestionHandoffChip`): a link to the card, a title line with
 * an optional icon, a one-line summary, and badges below.
 */

import type { ReactNode } from "react";
import { useParams } from "@tanstack/react-router";
import { withBase } from "../../api";
import { cardUrl } from "@shared/card-url";

export function AttachmentChipFrame({
  doc,
  icon,
  title,
  summary,
  children,
}: {
  /** The card the chip opens. */
  doc: string;
  icon?: ReactNode;
  title: ReactNode;
  /** Shown under the title when not empty. */
  summary: string;
  /** Badges, shown under the summary. */
  children?: ReactNode;
}) {
  const { boxSlug } = useParams({ strict: false });
  const href = withBase(cardUrl(boxSlug ?? "", doc));
  return (
    <a href={href} className="bbx-chat-user-attachment block rounded-lg bg-black/15 px-3 py-2 hover:bg-black/25">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        <span>{title}</span>
      </div>
      {summary !== "" ? <div className="bbx-chat-user-attachment-summary mt-0.5 text-xs text-white/85">{summary}</div> : null}
      {children}
    </a>
  );
}
