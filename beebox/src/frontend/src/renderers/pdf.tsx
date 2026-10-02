/**
 * PDF renderer — hands the raw file to `PdfFrame`, which embeds the browser's
 * built-in viewer and keeps Open/Download reachable when it can't render
 * inline (iOS).
 */

import { apiRawFileUrl, getApiBase } from "../api";
import { PdfFrame } from "../components/PdfFrame";
import { Text } from "../components/ui/Text";
import { toDisplayPath } from "@shared/display-path";
import { useVersionedFileUrl } from "../hooks/useVersionedFileUrl";
import type { RendererEntry, RendererProps } from "../file-type-registry";

const PDF_EXT = /\.pdf$/i;

function PdfRenderer({ data, mode, workspacePdf }: RendererProps) {
  const basename = data.path.split("/").pop() || data.path;
  const apiBase = getApiBase();
  const rawUrl = apiRawFileUrl(apiBase, data.path);
  const src = useVersionedFileUrl(rawUrl, { path: data.path });
  if (src.state === "loading") return <Text as="div" tone="subtle" className="p-4">Loading PDF…</Text>;
  if (src.state === "missing") return <Text as="div" tone="subtle" className="p-4">File not found: {toDisplayPath(data.path)}</Text>;
  return <PdfFrame src={src.url} title={basename} downloadName={basename} mode={mode ?? "page"} workspacePdf={workspacePdf} />;
}

export const pdfRenderer: RendererEntry = {
  selector: { match: (path) => PDF_EXT.test(path) },
  renderer: { name: "PDF", Component: PdfRenderer, priority: 30 },
};
