/**
 * Markdown renderer — rendered from pre-loaded text content.
 */

import { Markdown } from "../components/Markdown/body";
import { StatusMessage } from "../components/ui/StatusMessage";
import { CardThemeContent } from "../components/themes/CardThemeContent";
import type { RendererEntry, RendererProps } from "../file-type-registry";

function MarkdownRenderer({ data, onNavigate, mode }: RendererProps) {
  if (data.content === undefined) {
    return <StatusMessage className="p-4">No content</StatusMessage>;
  }
  const content = <Markdown prose="block" onNavigate={onNavigate} basePath={data.path}>{data.content}</Markdown>;
  if (mode !== "embed") return <CardThemeContent>{content}</CardThemeContent>;
  return <div className="p-4">{content}</div>;
}

export const markdownRenderer: RendererEntry = {
  selector: { match: (path) => path.endsWith(".md") },
  renderer: { name: "Markdown", Component: MarkdownRenderer, priority: 50 },
};
