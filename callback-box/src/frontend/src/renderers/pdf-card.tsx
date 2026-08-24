/**
 * Pdf card renderers.
 *
 * Two views of the same card, toggled in FileView's chrome:
 *  - "Text" (default) — the extracted text with its pages and metadata.
 *  - "Original" — the file the text came from, in the browser's PDF viewer.
 *
 * The type string and command text live in `lib/pdf-card.ts` (one place each).
 */

import { useParams } from "@tanstack/react-router";
import { PdfCardView } from "../components/PdfCardView";
import { PdfFrame } from "../components/PdfFrame";
import { Text } from "../components/ui/Text";
import { apiFileUrl, resolveRelativePath } from "../lib/view-url";
import {
  EXTRACTED_CARD_TYPE,
  ORIGINAL_RENDERER_NAME,
  readExtractedFields,
} from "../lib/pdf-card";
import type { RendererProps } from "./index";
import { registerFileType } from "./index";

function OriginalDocumentView({ data, mode }: RendererProps) {
  const { boxSlug } = useParams({ strict: false });
  const { originalRef } = readExtractedFields(data.frontmatter);
  // `attach/source.pdf` resolves into this card's own attach scope; a ref that
  // escapes the box root resolves to null and lands in the notice below.
  const originalPath = originalRef === null ? null : resolveRelativePath(data.path, originalRef);
  if (originalPath === null || boxSlug === undefined) {
    return (
      <Text as="p" tone="subtle" className="p-4">
        This card doesn&rsquo;t point at an original file.
      </Text>
    );
  }
  const name = originalPath.split("/").pop() ?? originalPath;
  return (
    <PdfFrame
      src={apiFileUrl(boxSlug, originalPath)}
      title={name}
      downloadName={name}
      mode={mode ?? "page"}
    />
  );
}

registerFileType({ type: EXTRACTED_CARD_TYPE }, {
  renderer: { name: "Text", Component: PdfCardView, priority: 100 },
});

registerFileType({ type: EXTRACTED_CARD_TYPE }, {
  renderer: { name: ORIGINAL_RENDERER_NAME, Component: OriginalDocumentView, priority: 90 },
});
