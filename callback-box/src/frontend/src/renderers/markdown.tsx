/**
 * Markdown renderer — rendered from pre-loaded text content.
 */

import { Markdown } from "../components/Markdown";
import { registerFileRenderer, type RendererProps } from "./index";

function MarkdownRenderer({ data }: RendererProps) {
  if (data.content === undefined) {
    return <div className="p-4 text-warm-600">No content</div>;
  }
  return (
    <div className="p-4">
      <div className="prose prose-sm max-w-none">
        <Markdown>{data.content}</Markdown>
      </div>
    </div>
  );
}

registerFileRenderer(
  (path) => path.endsWith(".md"),
  { name: "Markdown", Component: MarkdownRenderer, priority: 50 },
);
