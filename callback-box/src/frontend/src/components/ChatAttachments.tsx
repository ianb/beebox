/**
 * Attachment panel for the chat composer.
 *
 * Displays thumbnails of images pasted/dropped into the chat input. Each
 * thumbnail references a numeric id that appears as `[imageN]` in the
 * textarea; clicking a thumbnail opens it in a lightbox, the trash button
 * removes the attachment and strips its `[imageN]` token from the text.
 */

import { Image } from "./ui/Image";
import { useLightbox } from "./LightboxProvider";

/** UI-side attachment record (pairs ChatImageAttachment payload with preview metadata). */
export interface AttachmentItem {
  id: number;
  mimeType: string;
  /** base64 payload (no data: prefix) — sent as-is to backend. */
  dataBase64: string;
  /** Object URL for thumbnail/lightbox preview. */
  objectUrl: string;
  /** Approximate byte size of the encoded image, for tooltip display. */
  byteLength: number;
}

export function AttachmentPanel({
  attachments,
  onRemove,
}: {
  attachments: AttachmentItem[];
  onRemove: (id: number) => void;
}) {
  const lightbox = useLightbox();

  if (attachments.length === 0) return null;

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
