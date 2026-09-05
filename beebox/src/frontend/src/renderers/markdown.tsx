/**
 * Markdown renderer — rendered from pre-loaded text content.
 */

import { Markdown } from "../components/Markdown";
import { Text } from "../components/ui/Text";
import { registerFileType, type RendererProps } from "./index";

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

registerFileType(
  { match: (path) => path.endsWith(".md") },
  { renderer: { name: "Markdown", Component: MarkdownRenderer, priority: 50 } },
);
