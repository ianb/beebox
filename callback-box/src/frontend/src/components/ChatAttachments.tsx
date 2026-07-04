/**
 * Attachment panel for the chat composer.
 *
 * Displays thumbnails of images pasted/dropped into the chat input. Each
 * thumbnail references a numeric id that appears as `[imageN]` in the
 * textarea; clicking a thumbnail opens it in a lightbox, the trash button
 * removes the attachment and strips its `[imageN]` token from the text.
 *
 * The parallel `FileAttachmentPanel` shows uploaded non-image files which
 * the composer references via `[fileN]` tokens.
 */

import { Image } from "./ui/Image";
import { useLightbox } from "./LightboxProvider";
import { formatBytes } from "../lib/format-bytes";
import type { ImageItem, FileItem } from "../input/emission-store";

/**
 * UI-side attachment record (pairs ChatImageAttachment payload with preview
 * metadata). Defined in `input/emission-store.ts` (the ONE emission-draft
 * store, chunk 2 of docs/plans/input-extraction.md); re-exported here under
 * its historical name so this component's own prop types read naturally.
 */
export type AttachmentItem = ImageItem;

export function AttachmentPanel({
  attachments,
  pendingCount,
  onRemove,
}: {
  attachments: AttachmentItem[];
  /** Images pasted/dropped but still encoding — shown as placeholder tiles. */
  pendingCount: number;
  onRemove: (id: number) => void;
}) {
  const lightbox = useLightbox();

  if (attachments.length === 0 && pendingCount === 0) return null;

  const openAt = (clickedId: number) => {
    const images = attachments.map((a) => ({
      src: a.objectUrl,
      alt: `image${a.id}`,
    }));
    const index = attachments.findIndex((a) => a.id === clickedId);
    if (index !== -1) lightbox.openList(images, index);
  };

  return (
    <div className="flex flex-wrap gap-2 px-3 py-2 border-t border-warm-300 bg-warm-100/70">
      {attachments.map((att) => (
        <ThumbTile
          key={att.id}
          attachment={att}
          onClick={() => openAt(att.id)}
          onRemove={() => onRemove(att.id)}
        />
      ))}
      {Array.from({ length: pendingCount }, (_unused, i) => (
        <PendingThumb key={`pending-${i}`} />
      ))}
    </div>
  );
}

/** Placeholder tile shown while a pasted image is still being encoded. */
function PendingThumb() {
  return (
    <div
      className="w-16 h-16 rounded border border-warm-300 bg-warm-200 flex items-center justify-center"
      title="Processing image…"
      aria-label="Processing image"
    >
      <svg className="w-5 h-5 animate-spin text-warm-500" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  );
}

function ThumbTile({
  attachment,
  onClick,
  onRemove,
}: {
  attachment: AttachmentItem;
  onClick: () => void;
  onRemove: () => void;
}) {
  const kb = Math.round(attachment.byteLength / 1024);
  return (
    <div className="relative group" data-cb-source={`attachment-${attachment.id}`}>
      <button
        type="button"
        onClick={onClick}
        className="block rounded bg-warm-200 overflow-hidden hover:ring-2 hover:ring-accent focus:outline-none focus:ring-2 focus:ring-accent"
        title={`image${attachment.id} · ${kb} KB · click to zoom`}
      >
        <Image
          src={attachment.objectUrl}
          alt={`image${attachment.id}`}
          size="thumb"
          bordered
        />
      </button>
      <div className="absolute -top-1 left-0 text-[10px] font-mono bg-warm-800 text-white px-1 rounded pointer-events-none">
        {attachment.id}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-danger text-white flex items-center justify-center shadow hover:bg-danger-dark focus:outline-none focus:ring-2 focus:ring-danger"
        title="Remove attachment"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/**
 * UI-side record for a chat file attachment (token id, saved path, and the
 * metadata needed to render the chip). Defined in `input/emission-store.ts`;
 * re-exported under its historical name.
 */
export type FileAttachmentItem = FileItem;

export function FileAttachmentPanel({
  attachments,
  onRemove,
}: {
  attachments: FileAttachmentItem[];
  onRemove: (id: number) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-3 py-2 border-t border-warm-300 bg-warm-100/70">
      {attachments.map((att) => (
        <FileChip
          key={att.id}
          attachment={att}
          onRemove={() => onRemove(att.id)}
        />
      ))}
    </div>
  );
}

function FileChip({
  attachment,
  onRemove,
}: {
  attachment: FileAttachmentItem;
  onRemove: () => void;
}) {
  const sizeLabel = formatBytes(attachment.size);
  return (
    <div
      className="relative group flex items-center gap-2 pl-2 pr-7 py-1.5 rounded bg-warm-200 border border-warm-300 max-w-xs"
      data-cb-source={`file-attachment-${attachment.id}`}
      title={`file${attachment.id} · ${attachment.originalName} · ${sizeLabel}`}
    >
      <span className="text-[10px] font-mono bg-warm-800 text-white px-1 rounded flex-shrink-0">
        {attachment.id}
      </span>
      <svg className="w-4 h-4 text-warm-600 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <div className="flex flex-col min-w-0 leading-tight">
        <span className="truncate text-xs font-medium text-warm-800">
          {attachment.originalName}
        </span>
        <span className="text-[10px] text-warm-600">{sizeLabel}</span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-danger text-white flex items-center justify-center shadow hover:bg-danger-dark focus:outline-none focus:ring-2 focus:ring-danger"
        title="Remove attachment"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
