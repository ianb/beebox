/**
 * Built-in file renderers: XML view and Card Tree view.
 */

import { useMemo } from "react";
import { CardTreeView } from "../components/CardTreeView";
import { Pre } from "../components/ui/Pre";
import { HighlightedCode } from "../components/ui/HighlightedCode";
import { Text } from "../components/ui/Text";
import hljs from "highlight.js/lib/core";
import xml from "highlight.js/lib/languages/xml";
import type { RendererProps } from "./index";
import { registerFileRenderer } from "./index";

hljs.registerLanguage("xml", xml);

/** Syntax-highlighted XML view */
function XmlRenderer({ data }: RendererProps) {
  const highlighted = useMemo(() => {
    if (!data.xml) return "";
    return hljs.highlight(data.xml, { language: "xml" }).value;
  }, [data.xml]);

  if (!data.xml) {
    return <Text as="div" tone="subtle" className="p-4">No XML content</Text>;
  }

  return (
    <div className="p-4">
      <Pre boxed>
        <HighlightedCode html={highlighted} />
      </Pre>
    </div>
  );
}

/** Raw source view for frontmatter cards — no XML highlighting. */
function SourceRenderer({ data }: RendererProps) {
  if (!data.xml) {
    return <Text as="div" tone="subtle" className="p-4">No content</Text>;
  }
  return (
    <div className="p-4">
      <Pre boxed>{data.xml}</Pre>
    </div>
  );
}

/** Structured card tree view */
function TreeRenderer({ data, onNavigate }: RendererProps) {
  if (!data.element) {
    return <Text as="div" tone="subtle" className="p-4">No element data</Text>;
  }
  return <CardTreeView element={data.element} path={data.path} onNavigate={onNavigate} />;
}

// Register built-in renderers
registerFileRenderer(
  (path, data) => path.endsWith(".card") && data.kind !== "frontmatter",
  { name: "XML", Component: XmlRenderer, priority: 10 },
);

registerFileRenderer(
  (_path, data) => data.kind === "frontmatter",
  { name: "Source", Component: SourceRenderer, priority: 10 },
);

registerFileRenderer(
  (_path, data) => !!data.element,
  { name: "Card Tree", Component: TreeRenderer, priority: 20 },
);
