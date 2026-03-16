/**
 * Built-in file renderers: XML view and Card Tree view.
 */

import { useMemo } from "react";
import { CardTreeView } from "../components/CardTreeView";
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

  if (!data.xml) return <div className="p-4 text-warm-600">No XML content</div>;

  return (
    <div className="p-4">
      <div className="bg-warm-100 rounded p-4 overflow-auto">
        <pre className="text-sm whitespace-pre-wrap font-mono">
          <code
            className="hljs"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </pre>
      </div>
    </div>
  );
}

/** Structured card tree view */
function TreeRenderer({ data }: RendererProps) {
  if (!data.element) return <div className="p-4 text-warm-600">No element data</div>;
  return <CardTreeView element={data.element} path={data.path} />;
}

// Register built-in renderers
registerFileRenderer(
  (path) => path.endsWith(".card"),
  { name: "XML", Component: XmlRenderer, priority: 10 },
);

registerFileRenderer(
  (_path, data) => !!data.element,
  { name: "Card Tree", Component: TreeRenderer, priority: 20 },
);
