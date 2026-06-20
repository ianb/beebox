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
import { trpc } from "../lib/trpc";
import { getRenderers, type FileData } from "../renderers/index";
import { useViewNavigate } from "../hooks/useViewNavigate";
import type { NavigateHint, ViewTarget } from "../lib/view-url";

type NavigateFn = (target: ViewTarget, hint?: NavigateHint) => void;

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
  /**
   * Optional navigation handler for ref clicks. When omitted, falls back to
   * the default URL-pushing behavior (`useViewNavigate`). Surfaces that want
   * to keep ref clicks within their layout (browse, companion pane) should
   * pass their own.
   */
  onNavigate?: NavigateFn;
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
    confidence: "bg-info-100 text-primary-dark",
    status: "bg-success-100 text-success-dark",
    source: "bg-info-100 text-info-dark",
    aspect: "bg-warning-100 text-warning-dark",
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
  // Absolute refs (leading /) are relative to box root
  if (ref.startsWith("/")) {
    return ref.slice(1);
  }
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
function RefExpander({ refPath, onNavigate }: { refPath: string; onNavigate: NavigateFn }) {
  const [expanded, setExpanded] = useState(false);
  const query = trpc.card.get.useQuery(
    { path: refPath },
    { enabled: expanded }
  );

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-primary hover:text-primary-dark hover:underline flex items-center gap-1"
      >
        <span className="text-[10px]">{expanded ? "\u25BC" : "\u25B6"}</span>
        {refPath.split("/").pop()}
      </button>
      {expanded ? (
        <div className="mt-1 ml-2 border-l-2 border-primary-light pl-3">
          {query.isLoading ? (
            <div className="text-xs text-warm-500">Loading...</div>
          ) : query.error ? (
            <div className="text-xs text-danger-dark">
              Failed to load: {query.error.message}
            </div>
          ) : query.data ? (
            <RefExpanderCard refPath={refPath} data={query.data} onNavigate={onNavigate} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Render a loaded card ref — uses the renderer registry (same as card viewer),
 * falls back to ElementTree.
 */
function RefExpanderCard({ refPath, data, onNavigate }: {
  refPath: string;
  data: { element?: ElementNode; path: string; type?: string; xml?: string; version?: string; status?: string };
  onNavigate: NavigateFn;
}) {
  const fileData: FileData = {
    path: data.path || refPath,
    type: data.type,
    element: data.element,
    xml: data.xml,
    version: data.version,
    status: data.status,
  };

  const renderers = getRenderers(refPath, fileData);
  if (renderers.length > 0) {
    const Renderer = renderers[0].Component;
    return <Renderer data={fileData} onNavigate={onNavigate} />;
  }

  if (data.element) {
    return <ElementTree element={data.element} depth={1} cardPath={refPath} onNavigate={onNavigate} />;
  }

  return null;
}

/**
 * Render the `ref` line under an element header: card refs expand inline,
 * non-card refs become a file-view link, and unresolved refs render as text.
 */
function RefLine({
  refAttr, resolvedRef, isCardRef, onNavigate,
}: {
  refAttr: string;
  resolvedRef: string | null;
  isCardRef: boolean;
  onNavigate: NavigateFn;
}) {
  if (isCardRef && resolvedRef) {
    return <RefExpander refPath={resolvedRef} onNavigate={onNavigate} />;
  }
  if (resolvedRef) {
    return (
      <button
        onClick={() => onNavigate({ path: resolvedRef, viewer: null, params: {}, zoom: false })}
        className="text-xs text-primary hover:text-primary-dark hover:underline mt-0.5 block text-left"
      >
        {refAttr}
      </button>
    );
  }
  return <div className="text-xs text-warm-500 mt-0.5">{refAttr}</div>;
}

/**
 * Render a single element node.
 */
function ElementTree({ element, depth: depthArg, cardPath, onNavigate }: ElementTreeProps) {
  const depth = depthArg ?? 0;
  const [collapsed, setCollapsed] = useState(false);
  const fallbackNavigate = useViewNavigate();
  const handleNavigate = onNavigate ?? fallbackNavigate;
  const hasChildren = element.children && element.children.length > 0;
  const hasContent = element.text || hasChildren;

  // Check for ref attribute pointing to a card
  const refAttr = element.attrs.ref;
  const resolvedRef = refAttr && cardPath ? resolveRef(refAttr, cardPath) : null;
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
          <ElementTree key={i} element={child} depth={depth} cardPath={cardPath} onNavigate={onNavigate} />
        ))}
      </>
    );
  }

  // Get non-empty attributes (exclude ref since we handle it specially below)
  const attrs = Object.entries(element.attrs).filter(
    ([key, value]) => value !== undefined && value !== "" && key !== "ref"
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

      {refAttr ? (
        <RefLine
          refAttr={refAttr}
          resolvedRef={resolvedRef}
          isCardRef={Boolean(isCardRef)}
          onNavigate={handleNavigate}
        />
      ) : null}

      {/* Content */}
      {!collapsed && hasContent ? <div className="mt-1">
          {/* Text content rendered as Markdown */}
          {element.text ? <div className="prose prose-sm max-w-none text-warm-700">
              <Markdown onNavigate={handleNavigate} basePath={cardPath}>
                {element.text}
              </Markdown>
            </div> : null}

          {/* Children */}
          {element.children && element.children.length > 0 ? <div className="mt-2">
              {element.children.map((child, i) => (
                <ElementTree key={i} element={child} depth={depth + 1} cardPath={cardPath} onNavigate={onNavigate} />
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
  /** Optional navigation handler — see ElementTreeProps. */
  onNavigate?: NavigateFn;
}

/**
 * Full card tree view with header.
 */
export function CardTreeView({ element, path, version, onNavigate }: CardTreeViewProps) {
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
      <ElementTree element={element} cardPath={path} onNavigate={onNavigate} />
    </div>
  );
}

export default CardTreeView;
