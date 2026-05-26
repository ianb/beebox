/**
 * Markdown renderer — rendered from pre-loaded text content.
 */

import { Markdown } from "../components/Markdown";
import { Text } from "../components/ui/Text";
import { registerFileRenderer, type RendererProps } from "./index";

function MarkdownRenderer({ data, onNavigate }: RendererProps) {
  if (data.content === undefined) {
    return <Text as="div" tone="subtle" className="p-4">No content</Text>;
  }
  return (
    <div className="p-4">
      <Markdown prose="block" onNavigate={onNavigate} basePath={data.path}>
        {data.content}
      </Markdown>
    </div>
  );
}

registerFileRenderer(
  (path) => path.endsWith(".md"),
  { name: "Markdown", Component: MarkdownRenderer, priority: 50 },
);
