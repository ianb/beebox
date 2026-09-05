/**
 * PdfFrame — the one way a PDF is shown in the app.
 *
 * A toolbar row (filename + Open / Download) above an `<object>` carrying the
 * browser's built-in PDF viewer. `<object>` rather than `<iframe>` on purpose:
 * when the browser can't render a PDF inline (iOS/WKWebView, which shows a
 * blank rectangle for an embedded PDF) it renders the element's *children*
 * instead, so the fallback below repeats the Open/Download affordances rather
 * than leaving a dead grey box.
 *
 * Used by the `.pdf` file renderer and by the "Original" view of an extracted
 * document card.
 */

import { ExternalIconLink } from "./ui/ExternalIconLink";
import { ExternalLink } from "./ui/ExternalLink";
import { Text } from "./ui/Text";

export type PdfFrameMode = "page" | "chat" | "companion" | "embed";

export interface PdfFrameProps {
  /** URL of the raw PDF bytes. */
  src: string;
  /** Human label for the document — shown in the toolbar and as the frame title. */
  title: string;
  /** Suggested filename for the download link. */
  downloadName: string;
  /** The surface this frame sits in; decides how it takes height. */
  mode?: PdfFrameMode;
}

/**
 * How the frame takes height per surface. `page` owns the viewport, so a
 * viewport-relative height is right there. `chat` sits inside FileView's
 * `max-h-96` wrapper and must fit within it. `companion`/`embed` fill whatever
 * their container gives them (FileView's companion wrapper is a column flex).
 */
const OUTER_CLASSES: Record<PdfFrameMode, string> = {
  page: "flex flex-col",
  chat: "flex flex-col",
  companion: "flex flex-col h-full min-h-0",
  embed: "flex flex-col h-full min-h-0",
};

const FRAME_CLASSES: Record<PdfFrameMode, string> = {
  page: "w-full h-[80vh]",
  chat: "w-full h-80",
  // `flex-1` fills the pane when an ancestor actually has a height to give;
  // `min-h-[70vh]` is the floor for when none does. The companion pane's own
  // ancestors (the browse detail card, the chat sidebar's inner wrapper) are
  // content-sized, so without the floor a PDF collapses to ~150px there.
  companion: "w-full flex-1 min-h-[70vh]",
  embed: "w-full flex-1 min-h-[70vh]",
};

function PdfActions({ src, downloadName }: { src: string; downloadName: string }) {
  return (
    <>
      <ExternalLink href={src} variant="button" download={downloadName}>
        Download
      </ExternalLink>
      <ExternalIconLink href={src} label={`Open ${downloadName} in a new tab`} size="sm" />
    </>
  );
}

export function PdfFrame({ src, title, downloadName, mode }: PdfFrameProps) {
  const surface = mode ?? "page";
  return (
    <div className={OUTER_CLASSES[surface]}>
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-warm-200 bg-warm-50">
        <Text size="sm" tone="emphasis" truncate className="flex-1 min-w-0" title={title}>
          {title}
        </Text>
        <PdfActions src={src} downloadName={downloadName} />
      </div>
      <object data={src} type="application/pdf" title={title} className={FRAME_CLASSES[surface]}>
        {/* Shown by the browser only when it can't display the PDF inline. */}
        <div className="p-4 flex flex-col items-start gap-3 bg-warm-50">
          <Text as="p" size="sm" tone="subtle">
            This PDF can&rsquo;t be displayed here. Open it in a new tab or download it.
          </Text>
          <div className="flex items-center gap-2">
            <PdfActions src={src} downloadName={downloadName} />
          </div>
        </div>
      </object>
    </div>
  );
}
