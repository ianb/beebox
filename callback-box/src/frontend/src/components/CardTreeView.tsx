/**
 * CardTreeView - Renders a card as a tree of elements with Markdown text.
 *
 * Shows XML elements as a structured tree where:
 * - Tag names are displayed as headers/labels
 * - Attributes are shown as badges/chips
 * - Text content is rendered as Markdown
 * - Children are nested visually
 */

import { useState } from "react";
import { Markdown } from "./Markdown";

/**
 * Element node from the API.
 */
export interface ElementNode {
  tagName: string;
  attrs: Record<string, string>;
  text?: string;
  children?: ElementNode[];
}

interface ElementTreeProps {
  element: ElementNode;
  depth?: number;
}

/**
 * Format a tag name for display.
 * Keeps kebab-case as-is for readability.
 */
function formatTagName(tagName: string): string {
  return tagName;
}

/**
 * Get a color class for an attribute based on its name.
 */
function getAttrColor(name: string): string {
  const colors: Record<string, string> = {
    confidence: "bg-iris-100 text-plum-dark",
    status: "bg-green-100 text-green-800",
    source: "bg-purple-100 text-purple-800",
    aspect: "bg-amber-100 text-amber-800",
    duration: "bg-cyan-100 text-cyan-800",
    id: "bg-warm-100 text-warm-700",
    version: "bg-warm-100 text-warm-700",
  };
  return colors[name] || "bg-warm-100 text-warm-700";
}

/**
 * Render a single element node.
 */
function ElementTree({ element, depth = 0 }: ElementTreeProps) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = element.children && element.children.length > 0;
  const hasContent = element.text || hasChildren;

  // Skip rendering empty containers that just wrap children
  const isWrapper =
    !element.text &&
    hasChildren &&
    Object.keys(element.attrs).length === 0 &&
    depth > 0;

  // For wrapper elements, just render children directly
  if (isWrapper && element.children) {
    return (
      <>
        {element.children.map((child, i) => (
          <ElementTree key={i} element={child} depth={depth} />
        ))}
      </>
    );
  }

  // Get non-empty attributes
  const attrs = Object.entries(element.attrs).filter(
    ([, value]) => value !== undefined && value !== ""
  );

  return (
    <div
      className={`${depth > 0 ? "ml-4 border-l-2 border-warm-300 pl-3" : ""} ${
        depth === 0 ? "" : "mt-3"
      }`}
    >
      {/* Header with tag name and attributes */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-warm-700 text-sm">
          {formatTagName(element.tagName)}
        </span>
        {attrs.map(([name, value]) => (
          <span
            key={name}
            className={`text-xs px-1.5 py-0.5 rounded ${getAttrColor(name)}`}
          >
            <span className="opacity-60">{name}:</span> {value}
          </span>
        ))}
        {hasContent ? <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-warm-500 hover:text-warm-700 w-4 h-4 flex items-center justify-center text-xs"
          >
            {collapsed ? "▶" : "▼"}
          </button> : null}
      </div>

      {/* Content */}
      {!collapsed && hasContent ? <div className="mt-1">
          {/* Text content rendered as Markdown */}
          {element.text ? <div className="prose prose-sm max-w-none text-warm-700">
              <Markdown>
                {element.text}
              </Markdown>
            </div> : null}

          {/* Children */}
          {element.children && element.children.length > 0 ? <div className="mt-2">
              {element.children.map((child, i) => (
                <ElementTree key={i} element={child} depth={depth + 1} />
              ))}
            </div> : null}
        </div> : null}
    </div>
  );
}

interface CardTreeViewProps {
  element: ElementNode;
  path?: string;
  version?: string;
}

/**
 * Full card tree view with header.
 */
export function CardTreeView({ element, path, version }: CardTreeViewProps) {
  return (
    <div className="p-4">
      {/* Card header */}
      {path ? <div className="mb-4 pb-3 border-b">
          <h2 className="text-lg font-bold text-warm-900">
            {formatTagName(element.tagName)}
          </h2>
          <div className="flex items-center gap-2 mt-1 text-sm text-warm-600">
            <span>{path}</span>
            {version ? <span className="text-xs bg-warm-100 px-1.5 py-0.5 rounded">
                v{version}
              </span> : null}
          </div>
        </div> : null}

      {/* Element tree */}
      <ElementTree element={element} />
    </div>
  );
}

export default CardTreeView;
