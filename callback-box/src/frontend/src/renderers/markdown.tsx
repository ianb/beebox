/**
 * Markdown renderer — rendered from pre-loaded text content.
 */

import { Markdown } from "../components/Markdown";
import { Text } from "../components/ui/Text";
import { registerFileRenderer, type RendererProps } from "./index";

function MarkdownRenderer({ data }: RendererProps) {
  if (data.content === undefined) {
    return (
      <div className="p-4">
        <Text tone="subtle">No content</Text>
      </div>
    );
  }
  return (
    <div className="p-4">
      <Markdown prose="block">{data.content}</Markdown>
    </div>
  );
}

registerFileRenderer(
  (path) => path.endsWith(".md"),
  { name: "Markdown", Component: MarkdownRenderer, priority: 50 },
);
