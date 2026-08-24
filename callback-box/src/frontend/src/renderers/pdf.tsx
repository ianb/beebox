/**
 * PDF renderer — hands the raw file to `PdfFrame`, which embeds the browser's
 * built-in viewer and keeps Open/Download reachable when it can't render
 * inline (iOS).
 */

import { getApiBase } from "../api";
import { PdfFrame } from "../components/PdfFrame";
import type { RendererProps } from "./index";
import { registerFileType } from "./index";

const PDF_EXT = /\.pdf$/i;

function PdfRenderer({ data, mode }: RendererProps) {
  const basename = data.path.split("/").pop() || data.path;
  const src = `${getApiBase()}/files/${data.path}`;
  return <PdfFrame src={src} title={basename} downloadName={basename} mode={mode ?? "page"} />;
}

registerFileType(
  { match: (path) => PDF_EXT.test(path) },
  { renderer: { name: "PDF", Component: PdfRenderer, priority: 30 } },
);
