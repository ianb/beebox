/**
 * PDF renderer — embeds the raw file in an iframe so the browser's
 * built-in PDF viewer does the rendering.
 */

import { getApiBase } from "../api";
import type { RendererProps } from "./index";
import { registerFileType } from "./index";

const PDF_EXT = /\.pdf$/i;

function PdfRenderer({ data }: RendererProps) {
  const basename = data.path.split("/").pop() || data.path;
  const src = `${getApiBase()}/files/${data.path}`;
  return (
    <iframe
      src={src}
      title={basename}
      className="w-full h-[85vh]"
      style={{ border: 0 }}
    />
  );
}

registerFileType(
  { match: (path) => PDF_EXT.test(path) },
  { renderer: { name: "PDF", Component: PdfRenderer, priority: 30 } },
);
