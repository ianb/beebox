/**
 * Markdown renderer — rendered from pre-loaded text content.
 */

import { Markdown } from "../components/Markdown";
import { Text } from "../components/ui/Text";
import { CardThemeContent } from "../components/themes/CardThemeContent";
import { registerFileType, type RendererProps } from "./index";

function MarkdownRenderer({ data, onNavigate, mode }: RendererProps) {
  if (data.content === undefined) {
    return <Text as="div" tone="subtle" className="p-4">No content</Text>;
  }
  const content = <Markdown prose="block" onNavigate={onNavigate} basePath={data.path}>{data.content}</Markdown>;
  if (mode !== "embed") return <CardThemeContent>{content}</CardThemeContent>;
  return <div className="p-4">{content}</div>;
}

registerFileType(
  { match: (path) => path.endsWith(".md") },
  { renderer: { name: "Markdown", Component: MarkdownRenderer, priority: 50 } },
);
