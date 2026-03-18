/**
 * CardTreeView - Renders a card as a tree of elements with Markdown text.
 *
 * Shows XML elements as a structured tree where:
 * - Tag names are displayed as headers/labels
 * - Attributes are shown as badges/chips
 * - Text content is rendered as Markdown
 * - Children are nested visually
 * - `ref` attributes are expandable to show referenced cards inline
 * - Image cards show their image inline
 */

import { useState } from "react";
import { Markdown } from "./Markdown";
import { ImageLightbox } from "./ImageLightbox";
import { trpc } from "../lib/trpc";
import { getApiBase } from "../api";

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
  /** Path of the card containing this element (for resolving relative refs) */
  cardPath?: string;
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
 * Resolve a ref path relative to the card's directory.
 */
function resolveRef(ref: string, cardPath: string): string {
  const cardDir = cardPath.split("/").slice(0, -1).join("/");
  if (!cardDir) return ref;
  // Simple path resolution: join and normalize
  const parts = `${cardDir}/${ref}`.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      resolved.pop();
    } else if (part !== ".") {
      resolved.push(part);
    }
  }
  return resolved.join("/");
}

/**
 * Inline expandable card ref viewer.
 */
function RefExpander({ refPath }: { refPath: string }) {
  const [expanded, setExpanded] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const query = trpc.card.get.useQuery(
    { path: refPath },
    { enabled: expanded }
  );

  // Check if the referenced card has an associated image file
  const hasImage = refPath.endsWith(".image.card");
  const imageFilename = hasImage
    ? query.data?.element?.children?.find((c: ElementNode) => c.tagName === "filename")?.attrs?.name
    : null;
  const imageDir = refPath.split("/").slice(0, -1).join("/");
  const imageSrc = imageFilename
    ? `${getApiBase()}/files/${imageDir}/${imageFilename}`
    : null;

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-plum hover:text-plum-dark hover:underline flex items-center gap-1"
      >
        <span className="text-[10px]">{expanded ? "\u25BC" : "\u25B6"}</span>
        {refPath.split("/").pop()}
      </button>
      {expanded ? (
        <div className="mt-1 ml-2 border-l-2 border-plum-light pl-3">
          {query.isLoading ? (
            <div className="text-xs text-warm-500">Loading...</div>
          ) : query.error ? (
            <div className="text-xs text-red-600">
              Failed to load: {query.error.message}
            </div>
          ) : query.data ? (
            <div>
              {imageSrc ? (
                <>
                  <img
                    src={imageSrc}
                    alt={imageFilename || "Referenced image"}
                    className="max-w-sm max-h-64 rounded border border-warm-300 mb-2 cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => setLightboxOpen(true)}
                    title="Click to zoom"
                  />
                  {lightboxOpen ? (
                    <ImageLightbox
                      src={imageSrc}
                      alt={imageFilename || "Referenced image"}
                      onClose={() => setLightboxOpen(false)}
                    />
                  ) : null}
                </>
              ) : null}
              <ElementTree
                element={query.data.element as ElementNode}
                depth={1}
                cardPath={refPath}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Render a single element node.
 */
function ElementTree({ element, depth = 0, cardPath }: ElementTreeProps) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = element.children && element.children.length > 0;
  const hasContent = element.text || hasChildren;

  // Check for ref attribute pointing to a card
  const ref = element.attrs.ref;
  const resolvedRef = ref && cardPath ? resolveRef(ref, cardPath) : null;
  const isCardRef = resolvedRef && resolvedRef.endsWith(".card");

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
          <ElementTree key={i} element={child} depth={depth} cardPath={cardPath} />
        ))}
      </>
    );
  }

  // Get non-empty attributes (exclude ref since we handle it specially)
  const attrs = Object.entries(element.attrs).filter(
    ([key, value]) => value !== undefined && value !== "" && (key !== "ref" || !isCardRef)
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
            {collapsed ? "\u25B6" : "\u25BC"}
          </button> : null}
      </div>

      {/* Expandable ref */}
      {isCardRef && resolvedRef ? (
        <RefExpander refPath={resolvedRef} />
      ) : ref ? (
        <div className="text-xs text-warm-500 mt-0.5">{ref}</div>
      ) : null}

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
                <ElementTree key={i} element={child} depth={depth + 1} cardPath={cardPath} />
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
      <ElementTree element={element} cardPath={path} />
    </div>
  );
}

export default CardTreeView;
